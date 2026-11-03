package com.sorat.agentpos;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private static final String APP_URL = "https://sorat.vercel.app/";
    private static final int BACK_PRESS_INTERVAL = 2000;

    private WebView webView;
    private long lastBackPressTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            setContentView(R.layout.activity_main);

            webView = findViewById(R.id.webView);
            if (webView == null) {
                webView = new WebView(this);
                setContentView(webView);
            }

            setupWebView();
            setupBackNavigation();

            webView.loadUrl(APP_URL);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        try {
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setLoadWithOverviewMode(true);
            settings.setUseWideViewPort(true);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setUserAgentString(settings.getUserAgentString() + " SoratApp/1.0.0");

            CookieManager.getInstance().setAcceptCookie(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
            }

            // Native Bluetooth Bridge for thermal receipt printing
            try {
                BluetoothPrinterBridge bridge = new BluetoothPrinterBridge(this, webView);
                webView.addJavascriptInterface(bridge, "AndroidBridge");
                webView.addJavascriptInterface(bridge, "AndroidPrinter");
            } catch (Exception e) {
                e.printStackTrace();
            }

            webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    try {
                        String url = request.getUrl().toString();
                        if (url.startsWith("https://sorat.vercel.app") || url.startsWith("http://sorat.vercel.app")) {
                            return false; // Load inside WebView!
                        }

                        // External intents: WhatsApp, Phone, etc.
                        if (url.startsWith("tel:") || url.startsWith("whatsapp:") || url.startsWith("mailto:")) {
                            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                            startActivity(intent);
                            return true;
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return false;
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    // Do not crash or block rendering
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void setupBackNavigation() {
        try {
            getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    try {
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            if (System.currentTimeMillis() - lastBackPressTime < BACK_PRESS_INTERVAL) {
                                setEnabled(false);
                                finish();
                            } else {
                                lastBackPressTime = System.currentTimeMillis();
                                Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT).show();
                            }
                        }
                    } catch (Exception e) {
                        finish();
                    }
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == BluetoothPrinterBridge.PERMISSION_REQUEST_CODE) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                Toast.makeText(this, "Bluetooth permission granted! You can now print.", Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, "Bluetooth permission is required for thermal receipt printer", Toast.LENGTH_LONG).show();
            }
        }
    }
}
