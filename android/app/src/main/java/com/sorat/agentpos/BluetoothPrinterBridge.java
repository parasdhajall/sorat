package com.sorat.agentpos;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public class BluetoothPrinterBridge {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    public static final int PERMISSION_REQUEST_CODE = 1001;

    // Persistent Socket to eliminate reconnect delay
    private static BluetoothSocket activeSocket = null;
    private static String activeAddress = null;
    private static String activeDeviceName = null;

    private final Activity activity;
    private final WebView webView;
    private final BluetoothAdapter bluetoothAdapter;

    public BluetoothPrinterBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
    }

    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }

    @JavascriptInterface
    public boolean hasPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        } else {
            return ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED;
        }
    }

    @JavascriptInterface
    public void requestPermissions() {
        activity.runOnUiThread(() -> {
            List<String> permissions = new ArrayList<>();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
                }
                if (ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                    permissions.add(Manifest.permission.BLUETOOTH_SCAN);
                }
            } else {
                if (ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH) != PackageManager.PERMISSION_GRANTED) {
                    permissions.add(Manifest.permission.BLUETOOTH);
                }
                if (ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_ADMIN) != PackageManager.PERMISSION_GRANTED) {
                    permissions.add(Manifest.permission.BLUETOOTH_ADMIN);
                }
                if (ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
                }
            }

            if (!permissions.isEmpty()) {
                ActivityCompat.requestPermissions(activity, permissions.toArray(new String[0]), PERMISSION_REQUEST_CODE);
            }
        });
    }

    @JavascriptInterface
    public boolean isBluetoothEnabled() {
        return bluetoothAdapter != null && bluetoothAdapter.isEnabled();
    }

    @JavascriptInterface
    public boolean isSocketConnected() {
        return activeSocket != null && activeSocket.isConnected();
    }

    @JavascriptInterface
    public void openBluetoothSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            activity.startActivity(intent);
        } catch (Exception e) {
            activity.runOnUiThread(() ->
                Toast.makeText(activity, "Cannot open Bluetooth settings", Toast.LENGTH_SHORT).show()
            );
        }
    }

    @JavascriptInterface
    public String getPairedDevices() {
        JSONArray arr = new JSONArray();
        if (bluetoothAdapter == null) {
            return arr.toString();
        }

        if (!hasPermissions()) {
            requestPermissions();
            return arr.toString();
        }

        try {
            Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
            if (pairedDevices != null) {
                for (BluetoothDevice device : pairedDevices) {
                    JSONObject obj = new JSONObject();
                    obj.put("name", device.getName() != null ? device.getName() : "Unknown Device");
                    obj.put("address", device.getAddress());
                    arr.put(obj);
                }
            }
        } catch (SecurityException se) {
            requestPermissions();
        } catch (Exception ignored) {
        }
        return arr.toString();
    }

    @JavascriptInterface
    public synchronized void disconnect() {
        if (activeSocket != null) {
            try {
                activeSocket.close();
            } catch (Exception ignored) {}
            activeSocket = null;
            activeAddress = null;
            activeDeviceName = null;
        }
    }

    // Connect to printer socket in advance so print is instant
    @JavascriptInterface
    public synchronized String connect(String deviceAddress) {
        JSONObject res = new JSONObject();
        if (activeSocket != null && activeSocket.isConnected()) {
            if (deviceAddress == null || deviceAddress.isEmpty() || (activeAddress != null && activeAddress.equalsIgnoreCase(deviceAddress))) {
                try {
                    res.put("success", true);
                    res.put("message", "Already connected to " + activeDeviceName);
                    res.put("deviceName", activeDeviceName);
                    res.put("deviceAddress", activeAddress);
                    return res.toString();
                } catch (Exception ignored) {}
            }
        }

        BluetoothDevice dev = findDevice(deviceAddress);
        if (dev == null) {
            return errorJson("No printer found. Please pair printer first.");
        }

        try {
            openSocket(dev);
            res.put("success", true);
            res.put("message", "Connected to " + dev.getName());
            res.put("deviceName", dev.getName());
            res.put("deviceAddress", dev.getAddress());
            return res.toString();
        } catch (Exception e) {
            return errorJson("Connection failed: " + e.getMessage());
        }
    }

    @JavascriptInterface
    public synchronized String print(String deviceAddress, String base64EscPos) {
        JSONObject res = new JSONObject();
        if (bluetoothAdapter == null) {
            return errorJson("Bluetooth is not supported on this device.");
        }

        if (!bluetoothAdapter.isEnabled()) {
            return errorJson("Bluetooth is turned OFF. Please turn on Bluetooth.");
        }

        if (!hasPermissions()) {
            requestPermissions();
            return errorJson("Bluetooth permission required. Please allow permission and try again.");
        }

        byte[] data;
        try {
            data = Base64.decode(base64EscPos, Base64.NO_WRAP);
        } catch (Exception e) {
            return errorJson("Invalid print data.");
        }

        // FAST PATH: If already connected to target printer, send data INSTANTLY without reconnecting!
        if (activeSocket != null && activeSocket.isConnected()) {
            boolean addressMatches = deviceAddress == null || deviceAddress.trim().isEmpty() ||
                    (activeAddress != null && activeAddress.equalsIgnoreCase(deviceAddress.trim()));

            if (addressMatches) {
                try {
                    OutputStream os = activeSocket.getOutputStream();
                    os.write(data);
                    os.flush();

                    res.put("success", true);
                    res.put("message", "Receipt printed instantly to " + activeDeviceName + "!");
                    res.put("deviceName", activeDeviceName);
                    res.put("deviceAddress", activeAddress);
                    return res.toString();
                } catch (Exception writeEx) {
                    // Socket was broken, close and reconnect below
                    try { activeSocket.close(); } catch (Exception ignored) {}
                    activeSocket = null;
                    activeAddress = null;
                    activeDeviceName = null;
                }
            }
        }

        // RECONNECT PATH: Find device and connect once, then KEEP ALIVE
        BluetoothDevice targetDevice = findDevice(deviceAddress);
        if (targetDevice == null) {
            return errorJson("No paired Bluetooth printer found! Please pair in Bluetooth settings first.");
        }

        try {
            openSocket(targetDevice);
            OutputStream os = activeSocket.getOutputStream();
            os.write(data);
            os.flush();

            // DO NOT CLOSE SOCKET! Keep it open for zero-delay instant printing on next play!
            res.put("success", true);
            res.put("message", "Receipt printed successfully to " + targetDevice.getName() + "!");
            res.put("deviceName", targetDevice.getName());
            res.put("deviceAddress", targetDevice.getAddress());
            return res.toString();

        } catch (Exception e) {
            if (activeSocket != null) {
                try { activeSocket.close(); } catch (Exception ignored) {}
                activeSocket = null;
                activeAddress = null;
                activeDeviceName = null;
            }
            return errorJson(e.getMessage() != null ? e.getMessage() : "Failed to print.");
        }
    }

    private BluetoothDevice findDevice(String deviceAddress) {
        try {
            Set<BluetoothDevice> bonded = bluetoothAdapter.getBondedDevices();
            if (bonded == null || bonded.isEmpty()) return null;

            if (deviceAddress != null && !deviceAddress.trim().isEmpty()) {
                for (BluetoothDevice dev : bonded) {
                    if (dev.getAddress().equalsIgnoreCase(deviceAddress.trim())) {
                        return dev;
                    }
                }
            }

            for (BluetoothDevice dev : bonded) {
                String name = dev.getName() != null ? dev.getName().toLowerCase() : "";
                if (name.contains("print") || name.contains("pos") || name.contains("mtp") ||
                    name.contains("inner") || name.contains("rp") || name.contains("mpt") ||
                    name.contains("veer") || name.contains("seznik") || name.contains("bt") ||
                    name.contains("thermal") || name.contains("bluetooth")) {
                    return dev;
                }
            }

            return bonded.iterator().next();
        } catch (SecurityException se) {
            requestPermissions();
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private void openSocket(BluetoothDevice device) throws Exception {
        if (activeSocket != null) {
            try { activeSocket.close(); } catch (Exception ignored) {}
            activeSocket = null;
        }

        bluetoothAdapter.cancelDiscovery();

        // 1. Try standard SPP UUID
        try {
            activeSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            activeSocket.connect();
        } catch (Exception ex) {
            // 2. Fallback to reflection port 1 if UUID connection fails
            try {
                Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                activeSocket = (BluetoothSocket) m.invoke(device, 1);
                if (activeSocket != null) {
                    activeSocket.connect();
                }
            } catch (Exception reflectionEx) {
                activeSocket = null;
                throw new Exception("Could not connect to " + device.getName() + ". Make sure printer is turned ON.");
            }
        }

        if (activeSocket == null || !activeSocket.isConnected()) {
            throw new Exception("Socket connection failed.");
        }

        activeAddress = device.getAddress();
        activeDeviceName = device.getName();
    }

    private String errorJson(String message) {
        try {
            JSONObject res = new JSONObject();
            res.put("success", false);
            res.put("message", message);
            return res.toString();
        } catch (Exception e) {
            return "{\"success\":false,\"message\":\"" + message + "\"}";
        }
    }
}

