// ========================================================================
// DIRECT ESC/POS THERMAL PRINTER DRIVER (NATIVE ANDROID BRIDGE + BLE)
// Powered by pattern from digitjodi for zero-dialog instant thermal printing
// ========================================================================

import { useState, useEffect } from "react";
import { ThermalTicket } from "./ticketStore";
import { getCardPureRoman } from "./cards";

export type PrinterStatus = "disconnected" | "connecting" | "connected";

export interface ConnectedPrinterInfo {
  name: string;
  id: string;
  connected: boolean;
}

export function isAndroidNativeApp(): boolean {
  return typeof window !== "undefined" && typeof (window as any).AndroidBridge !== "undefined";
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Common Thermal Printer Bluetooth GATT Service UUIDs
const COMMON_PRINTER_SERVICES = [
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC transparent UART (most common)
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // Everycom / generic POS
  "000018f0-0000-1000-8000-00805f9b34fb", // Standard ESC/POS
  "0000ff00-0000-1000-8000-00805f9b34fb", // FF00 generic thermal
  "0000ffe0-0000-1000-8000-00805f9b34fb", // HM-10 / CC2541 UART (very common in 58mm)
  "0000fff0-0000-1000-8000-00805f9b34fb", // FFF0 printer UART
  "0000ae00-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000af30-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "de5bf728-d711-4e47-af26-65e3012a5dc7", // Zijiang / Mstar
];

const KNOWN_WRITE_CHARS = [
  "49535343-8841-43f4-a8d4-ecbe34729bb3", // ISSC transparent write
  "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f", // POS write
  "0000ff02-0000-1000-8000-00805f9b34fb", // FF02 write
  "0000ffe1-0000-1000-8000-00805f9b34fb", // HM-10 UART write
  "0000fff1-0000-1000-8000-00805f9b34fb", // FFF1 write
  "0000fff2-0000-1000-8000-00805f9b34fb", // FFF2 write
  "00002af1-0000-1000-8000-00805f9b34fb", // ESC/POS write
];

/**
 * Build Raw ESC/POS bytes for 58mm / 80mm thermal receipt
 */
export function buildEscPosBytes(ticket: ThermalTicket, paperWidth: "58mm" | "80mm" = "58mm"): Uint8Array {
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);
  const text = (str: string) => {
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
  line("SORAT LIVE ARENA");
  push(0x1d, 0x21, 0x00); // Normal size
  push(0x1b, 0x45, 0x00); // Bold OFF
  line(divider);

  // 3. Left Align Meta Info
  push(0x1b, 0x61, 0x00); // Left align
  line(`Ticket No:  #${ticket.ticketId}`);
  line(`Date & Time: ${ticket.dateStr} ${ticket.timeStr}`);
  line(`Round No:   #${ticket.roundId}`);
  line(`Customer:   ${ticket.customerName || "Customer #1"}`);
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
    const cardTitle = getCardPureRoman(item.cardName);
    const left = `${idx + 1}. ${cardTitle}`;
    const right = `Rs ${item.amount}`;
    const pad = maxCols - left.length - right.length;
    line(`${left}${" ".repeat(Math.max(1, pad))}${right}`);
  });

  line(divider);

  // 5. Total Stake
  push(0x1b, 0x45, 0x01); // Bold ON
  const totalLeft = "TOTAL STAKE:";
  const totalRight = `Rs ${ticket.totalAmount}`;
  const totalPad = maxCols - totalLeft.length - totalRight.length;
  line(`${totalLeft}${" ".repeat(Math.max(1, totalPad))}${totalRight}`);
  push(0x1b, 0x45, 0x00); // Bold OFF
  line(divider);

  // 6. Barcode & Center
  push(0x1b, 0x61, 0x01); // Center align
  line(`*${ticket.barcode}*`);

  // 7. Feed 4 lines & Partial Paper Cut
  push(0x0a, 0x0a, 0x0a, 0x0a);
  push(0x1d, 0x56, 0x01); // GS V 1 (Partial cut)

  return new Uint8Array(bytes);
}

// Bluetooth Printer Manager Singleton
export class BluetoothPrinterManager {
  private device: any = null;
  private server: any = null;
  private writeChar: any = null;
  public status: PrinterStatus = "disconnected";
  public deviceName: string | null = null;
  public deviceAddress: string | null = null;
  private listeners: Set<() => void> = new Set();

  constructor() {
    if (typeof window !== "undefined") {
      this.deviceName = localStorage.getItem("sorat_printer_name") || null;
      this.deviceAddress = localStorage.getItem("sorat_printer_address") || null;
      if (isAndroidNativeApp() && this.deviceName) {
        this.status = "connected";
        const bridge = (window as any).AndroidBridge;
        if (bridge && bridge.connect && this.deviceAddress) {
          try {
            bridge.connect(this.deviceAddress);
          } catch (ignored) {}
        }
      }
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public isConnected(): boolean {
    if (isAndroidNativeApp()) {
      return this.status === "connected" && !!this.deviceName;
    }
    return Boolean(
      this.status === "connected" &&
      this.device &&
      this.device.gatt &&
      this.device.gatt.connected &&
      this.writeChar
    );
  }

  public async connect(): Promise<{ success: boolean; message: string }> {
    // 1. Native Android App Bridge
    if (isAndroidNativeApp()) {
      const bridge = (window as any).AndroidBridge;
      if (!bridge.isBluetoothEnabled()) {
        return {
          success: false,
          message: "Mobile Bluetooth OFF hai. Kripya Bluetooth ON karein.",
        };
      }
      if (!bridge.hasPermissions()) {
        bridge.requestPermissions();
        return {
          success: false,
          message: "Bluetooth permission allow karein aur dubara connect karein.",
        };
      }

      try {
        const raw = bridge.getPairedDevices();
        const devices: { name: string; address: string }[] = JSON.parse(raw || "[]");
        if (!devices || devices.length === 0) {
          if (bridge.openBluetoothSettings) {
            bridge.openBluetoothSettings();
          }
          return {
            success: false,
            message: "Koi paired Bluetooth printer nahi mila. Phone settings me pehle printer pair karein.",
          };
        }

        const target = devices.find((d) =>
          /print|pos|mtp|inner|rp|mpt|veer|seznik|bt|thermal/i.test(d.name)
        ) || devices[0];

        this.deviceName = target.name;
        this.deviceAddress = target.address;
        this.status = "connected";

        if (typeof window !== "undefined") {
          localStorage.setItem("sorat_printer_name", target.name);
          localStorage.setItem("sorat_printer_address", target.address);
        }

        if (bridge.connect) {
          try {
            bridge.connect(target.address);
          } catch (ignored) {}
        }

        this.notify();
        return {
          success: true,
          message: `Connected to ${target.name}!`,
        };
      } catch (err: any) {
        return {
          success: false,
          message: err.message || "Failed to load paired devices.",
        };
      }
    }

    // 2. Web Bluetooth API (Chrome Browser)
    const nav = navigator as any;
    if (!nav || !nav.bluetooth) {
      return {
        success: false,
        message: "Web Bluetooth is not supported in this browser. Please use Chrome on Android or PC.",
      };
    }

    try {
      this.status = "connecting";
      this.notify();

      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: COMMON_PRINTER_SERVICES,
      });

      if (!device || !device.gatt) {
        throw new Error("No device selected or Bluetooth GATT not available.");
      }

      device.addEventListener("gattserverdisconnected", () => {
        this.status = "disconnected";
        this.writeChar = null;
        this.server = null;
        this.notify();
      });

      const server = await device.gatt.connect();
      const services = await server.getPrimaryServices();

      let foundWriteChar: any = null;

      for (const service of services) {
        const sUuid = service.uuid.toLowerCase();

        // Ignore standard Bluetooth system services
        if (
          sUuid.includes("1800-") ||
          sUuid.includes("1801-") ||
          sUuid.includes("180a-") ||
          sUuid.includes("180f-")
        ) {
          continue;
        }

        try {
          const chars = await service.getCharacteristics();
          for (const c of chars) {
            const cUuid = c.uuid.toLowerCase();
            if (
              cUuid.includes("2a00-") ||
              cUuid.includes("2a01-") ||
              cUuid.includes("2a02-") ||
              cUuid.includes("2a03-") ||
              cUuid.includes("2a04-") ||
              cUuid.includes("2a05-") ||
              cUuid.includes("2a19-") ||
              cUuid.includes("2a29-")
            ) {
              continue;
            }

            if (c.properties.writeWithoutResponse || c.properties.write) {
              if (KNOWN_WRITE_CHARS.some((k) => cUuid.includes(k.slice(0, 8)))) {
                foundWriteChar = c;
                break;
              }
              if (!foundWriteChar) {
                foundWriteChar = c;
              }
            }
          }
        } catch {
          // ignore restricted services
        }
        if (
          foundWriteChar &&
          KNOWN_WRITE_CHARS.some((k) => foundWriteChar.uuid.toLowerCase().includes(k.slice(0, 8)))
        ) {
          break;
        }
      }

      if (!foundWriteChar) {
        throw new Error("Could not find print channel on this Bluetooth printer.");
      }

      this.device = device;
      this.server = server;
      this.writeChar = foundWriteChar;
      this.status = "connected";
      this.deviceName = device.name || "Bluetooth Printer";

      if (typeof window !== "undefined" && this.deviceName) {
        localStorage.setItem("sorat_printer_name", this.deviceName);
      }

      this.notify();
      return { success: true, message: `Connected to ${this.deviceName}!` };
    } catch (err: any) {
      this.status = "disconnected";
      this.writeChar = null;
      this.notify();
      return {
        success: false,
        message: err.message || "Failed to connect to printer",
      };
    }
  }

  public disconnect() {
    if (isAndroidNativeApp()) {
      const bridge = (window as any).AndroidBridge;
      if (bridge && bridge.disconnect) {
        try {
          bridge.disconnect();
        } catch (ignored) {}
      }
    }
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.status = "disconnected";
    this.writeChar = null;
    this.server = null;
    this.deviceName = null;
    this.deviceAddress = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem("sorat_printer_name");
      localStorage.removeItem("sorat_printer_address");
    }
    this.notify();
  }

  public async print(
    ticket: ThermalTicket,
    paperWidth: "58mm" | "80mm" = "58mm"
  ): Promise<{ success: boolean; message: string }> {
    const bytes = buildEscPosBytes(ticket, paperWidth);

    // 1. Native Android App Bridge
    if (isAndroidNativeApp()) {
      const bridge = (window as any).AndroidBridge;
      if (!bridge.isBluetoothEnabled()) {
        return {
          success: false,
          message: "Bluetooth OFF hai. Kripya phone ka Bluetooth ON karein.",
        };
      }
      if (!bridge.hasPermissions()) {
        bridge.requestPermissions();
        return {
          success: false,
          message: "Bluetooth permission allow karein aur dubara print karein.",
        };
      }

      const base64 = uint8ArrayToBase64(bytes);
      const resRaw = bridge.print(this.deviceAddress || "", base64);
      try {
        const res = JSON.parse(resRaw);
        if (res.success) {
          this.status = "connected";
          if (res.deviceName) this.deviceName = res.deviceName;
          if (res.deviceAddress) this.deviceAddress = res.deviceAddress;
          this.notify();
        }
        return res;
      } catch (e: any) {
        return { success: false, message: "Print response parse error: " + (e.message || "") };
      }
    }

    // 2. Web Bluetooth Direct
    if (this.isConnected()) {
      try {
        const chunkSize = 20; // 20-byte chunks for Android Chrome BLE buffer
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.slice(i, i + chunkSize);
          if (this.writeChar.properties.writeWithoutResponse && this.writeChar.writeValueWithoutResponse) {
            await this.writeChar.writeValueWithoutResponse(chunk);
          } else if (this.writeChar.writeValueWithResponse) {
            await this.writeChar.writeValueWithResponse(chunk);
          } else {
            await this.writeChar.writeValue(chunk);
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { success: true, message: "Receipt printed successfully!" };
      } catch (err: any) {
        this.status = "disconnected";
        this.writeChar = null;
        this.notify();
        return {
          success: false,
          message: err.message || "Print write failed.",
        };
      }
    }

    // 3. System Print Fallback
    if (typeof window !== "undefined") {
      window.print();
      return { success: true, message: "Opening System Print..." };
    }

    return { success: false, message: "No printer connected and window.print not available." };
  }
}

// Global Singleton Instance
export const printerManager = new BluetoothPrinterManager();

// React Hook
export function usePrinter() {
  const [, setTick] = useState(0);

  useEffect(() => {
    return printerManager.subscribe(() => setTick((t) => t + 1));
  }, []);

  return {
    status: printerManager.status,
    deviceName: printerManager.deviceName,
    isConnected: printerManager.isConnected(),
    isConnecting: printerManager.status === "connecting",
    connect: () => printerManager.connect(),
    disconnect: () => printerManager.disconnect(),
    print: (ticket: ThermalTicket, paperWidth: "58mm" | "80mm" = "58mm") =>
      printerManager.print(ticket, paperWidth),
  };
}

// Backward Compatibility Helpers
export function isBluetoothSupported(): boolean {
  if (isAndroidNativeApp()) return true;
  return typeof navigator !== "undefined" && Boolean((navigator as any).bluetooth);
}

export function isDirectPrinterConnected(): boolean {
  return printerManager.isConnected();
}

export function getActivePrinterName(): string {
  return printerManager.deviceName || "Bluetooth POS-58";
}

export async function connectBluetoothDirect(): Promise<{ success: boolean; deviceName: string; error?: string }> {
  const res = await printerManager.connect();
  return {
    success: res.success,
    deviceName: printerManager.deviceName || "",
    error: res.success ? undefined : res.message,
  };
}

export async function printDirectBluetooth(ticket: ThermalTicket, paperWidth: "58mm" | "80mm" = "58mm"): Promise<boolean> {
  const res = await printerManager.print(ticket, paperWidth);
  return res.success;
}

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
    window.location.href = `rawbt:data:application/octet-stream;base64,${base64}`;
    return true;
  } catch {
    return false;
  }
}

export async function executeDirectPrint(
  ticket: ThermalTicket,
  paperWidth: "58mm" | "80mm" = "58mm"
): Promise<{ method: "direct_bluetooth" | "rawbt" | "system_print"; success: boolean }> {
  if (printerManager.isConnected()) {
    const res = await printerManager.print(ticket, paperWidth);
    if (res.success) return { method: "direct_bluetooth", success: true };
  }

  if (typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || "")) {
    const rawOk = printViaRawBT(ticket, paperWidth);
    if (rawOk) return { method: "rawbt", success: true };
  }

  if (typeof window !== "undefined") {
    window.print();
    return { method: "system_print", success: true };
  }

  return { method: "system_print", success: false };
}
