// ========================================================================
// DIRECT ESC/POS THERMAL PRINTER DRIVER (BLUETOOTH & SILENT PRINT)
// ========================================================================

import { ThermalTicket } from "./ticketStore";

export interface ConnectedPrinterInfo {
  name: string;
  id: string;
  connected: boolean;
}

// Global cached characteristic for active session
let activeBluetoothDevice: any = null;
let activeWriteCharacteristic: any = null;

// Standard Bluetooth thermal printer Service and Characteristic UUIDs
const KNOWN_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000e0ff-3c17-d293-8e48-14fe2e4da212",
  "0000ff00-0000-1000-8000-00805f9b34fb",
];

/**
 * Check if Web Bluetooth API is supported in the current browser
 */
export function isBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as any).bluetooth);
}

/**
 * Check if a direct Bluetooth printer is currently connected
 */
export function isDirectPrinterConnected(): boolean {
  return Boolean(
    activeBluetoothDevice &&
    activeBluetoothDevice.gatt &&
    activeBluetoothDevice.gatt.connected &&
    activeWriteCharacteristic
  );
}

/**
 * Get active printer name
 */
export function getActivePrinterName(): string {
  if (isDirectPrinterConnected() && activeBluetoothDevice?.name) {
    return activeBluetoothDevice.name;
  }
  if (typeof window !== "undefined") {
    return localStorage.getItem("sorat_printer_name") || "Bluetooth POS-58";
  }
  return "Bluetooth POS-58";
}

/**
 * Connect directly to a Bluetooth Thermal Printer via Web Bluetooth
 */
export async function connectBluetoothDirect(): Promise<{ success: boolean; deviceName: string; error?: string }> {
  if (!isBluetoothSupported()) {
    return {
      success: false,
      deviceName: "",
      error: "Web Bluetooth is not supported in this browser. Please use Chrome on Android or Chrome on Windows/Mac.",
    };
  }

  try {
    const nav = navigator as any;
    const device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN_SERVICES,
    });

    if (!device) {
      return { success: false, deviceName: "", error: "No printer selected" };
    }

    const server = await device.gatt.connect();

    // Scan through known services or discover primary services
    let writeChar: any = null;

    for (const serviceUuid of KNOWN_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        if (service) {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              writeChar = char;
              break;
            }
          }
        }
      } catch {
        // service not present on this device, check next
      }
      if (writeChar) break;
    }

    // Fallback: search all primary services if none of known UUIDs matched
    if (!writeChar && server.getPrimaryServices) {
      try {
        const services = await server.getPrimaryServices();
        for (const s of services) {
          try {
            const chars = await s.getCharacteristics();
            for (const char of chars) {
              if (char.properties.write || char.properties.writeWithoutResponse) {
                writeChar = char;
                break;
              }
            }
          } catch {}
          if (writeChar) break;
        }
      } catch {}
    }

    if (!writeChar) {
      return {
        success: false,
        deviceName: device.name || "Bluetooth Printer",
        error: "Printer paired, but standard ESC/POS write service was not found.",
      };
    }

    activeBluetoothDevice = device;
    activeWriteCharacteristic = writeChar;

    const devName = device.name || "POS-58 Printer";
    if (typeof window !== "undefined") {
      localStorage.setItem("sorat_printer_name", devName);
      localStorage.setItem("sorat_printer_mode", "direct_bluetooth");
    }

    return {
      success: true,
      deviceName: devName,
    };
  } catch (err: any) {
    if (err.name === "NotFoundError") {
      return { success: false, deviceName: "", error: "Pairing cancelled by user." };
    }
    return {
      success: false,
      deviceName: "",
      error: err.message || "Failed to connect to Bluetooth printer.",
    };
  }
}

/**
 * Build Raw ESC/POS bytes for 58mm / 80mm thermal receipt
 */
export function buildEscPosBytes(ticket: ThermalTicket, paperWidth: "58mm" | "80mm" = "58mm"): Uint8Array {
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);
  const text = (str: string) => {
    // Basic ASCII / transliteration for thermal printers
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      push(code < 128 ? code : 0x3f);
    }
  };

  const line = (str: string) => {
    text(str);
    push(0x0a); // LF
  };

  const maxCols = paperWidth === "80mm" ? 42 : 32;
  const divider = "-".repeat(maxCols);

  // 1. Initialize Printer (ESC @)
  push(0x1b, 0x40);

  // 2. Center Align Header
  push(0x1b, 0x61, 0x01); // Center
  push(0x1b, 0x45, 0x01); // Bold ON
  push(0x1d, 0x21, 0x11); // Double width & height
  line("SORAT ARENA");
  push(0x1d, 0x21, 0x00); // Normal size
  push(0x1b, 0x45, 0x00); // Bold OFF
  line(divider);

  // 3. Left Align Meta Info
  push(0x1b, 0x61, 0x00); // Left align
  line(`Ticket No:  #${ticket.ticketId}`);
  line(`Date & Time: ${ticket.dateStr} ${ticket.timeStr}`);
  line(`Round No:   ${ticket.roundId}`);
  line(`Customer:   ${ticket.customerName || "Counter Client"}`);
  line(`Counter:    ${ticket.agentName}`);
  line(divider);

  // 4. Items Table
  push(0x1b, 0x45, 0x01); // Bold ON
  const colHeaderLeft = "PICTURE";
  const colHeaderRight = "BET (INR)";
  const spacePad = maxCols - colHeaderLeft.length - colHeaderRight.length;
  line(`${colHeaderLeft}${" ".repeat(Math.max(1, spacePad))}${colHeaderRight}`);
  push(0x1b, 0x45, 0x00); // Bold OFF

  ticket.items.forEach((item, idx) => {
    const left = `${idx + 1}. ${item.cardName}`;
    const right = `Rs ${item.amount}`;
    const pad = maxCols - left.length - right.length;
    line(`${left}${" ".repeat(Math.max(1, pad))}${right}`);
  });

  line(divider);

  // 5. Total Stake & Payout
  push(0x1b, 0x45, 0x01); // Bold ON
  const totalLeft = "TOTAL STAKE:";
  const totalRight = `Rs ${ticket.totalAmount}`;
  const totalPad = maxCols - totalLeft.length - totalRight.length;
  line(`${totalLeft}${" ".repeat(Math.max(1, totalPad))}${totalRight}`);
  push(0x1b, 0x45, 0x00); // Bold OFF

  const winLeft = "MAX WIN (10X):";
  const winRight = `Rs ${ticket.totalAmount * 10}`;
  const winPad = maxCols - winLeft.length - winRight.length;
  line(`${winLeft}${" ".repeat(Math.max(1, winPad))}${winRight}`);
  line(divider);

  // 6. Barcode & Footer
  push(0x1b, 0x61, 0x01); // Center align
  line(`*${ticket.barcode}*`);

  // 7. Feed 4 lines & Partial Paper Cut
  push(0x0a, 0x0a, 0x0a, 0x0a);
  push(0x1d, 0x56, 0x00); // GS V 0 (Cut paper)

  return new Uint8Array(bytes);
}

/**
 * Direct Print to Bluetooth Thermal Printer (Chunked BLE writes)
 */
export async function printDirectBluetooth(ticket: ThermalTicket, paperWidth: "58mm" | "80mm" = "58mm"): Promise<boolean> {
  if (!isDirectPrinterConnected()) {
    return false;
  }

  try {
    const rawBytes = buildEscPosBytes(ticket, paperWidth);
    const chunkSize = 128; // BLE friendly chunk size

    for (let offset = 0; offset < rawBytes.length; offset += chunkSize) {
      const chunk = rawBytes.slice(offset, offset + chunkSize);
      if (activeWriteCharacteristic.writeValueWithoutResponse) {
        await activeWriteCharacteristic.writeValueWithoutResponse(chunk);
      } else {
        await activeWriteCharacteristic.writeValue(chunk);
      }
      // Small 15ms pause between packets for low-cost thermal microcontrollers
      await new Promise((r) => setTimeout(r, 15));
    }

    return true;
  } catch (err) {
    console.error("Direct Bluetooth print failed:", err);
    return false;
  }
}

/**
 * Print via Android RawBT Print Service URL Protocol (bypasses Android print dialog)
 */
export function printViaRawBT(ticket: ThermalTicket, paperWidth: "58mm" | "80mm" = "58mm"): boolean {
  if (typeof window === "undefined") return false;

  try {
    const rawBytes = buildEscPosBytes(ticket, paperWidth);
    let binary = "";
    const len = rawBytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(rawBytes[i]);
    }
    const base64 = window.btoa(binary);
    // RawBT Intent URL for instant silent print
    window.location.href = `rawbt:data:application/octet-stream;base64,${base64}`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Master Direct Print Function:
 * 1. Tries Direct Web Bluetooth (Zero Dialog)
 * 2. If Android, tries RawBT (Zero Dialog)
 * 3. Falls back to window.print() (which is silent if Chrome has --kiosk-printing enabled!)
 */
export async function executeDirectPrint(
  ticket: ThermalTicket,
  paperWidth: "58mm" | "80mm" = "58mm"
): Promise<{ method: "direct_bluetooth" | "rawbt" | "system_print"; success: boolean }> {
  // Method 1: Direct Web Bluetooth
  if (isDirectPrinterConnected()) {
    const ok = await printDirectBluetooth(ticket, paperWidth);
    if (ok) return { method: "direct_bluetooth", success: true };
  }

  // Method 2: Android RawBT
  if (typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || "")) {
    const rawOk = printViaRawBT(ticket, paperWidth);
    if (rawOk) return { method: "rawbt", success: true };
  }

  // Method 3: Standard window.print() (Silent in Kiosk mode)
  if (typeof window !== "undefined") {
    window.print();
    return { method: "system_print", success: true };
  }

  return { method: "system_print", success: false };
}

