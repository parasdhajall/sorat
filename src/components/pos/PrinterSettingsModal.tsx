import React, { useState, useEffect } from "react";

interface PrinterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTestPrint: () => void;
}

export function PrinterSettingsModal({
  isOpen,
  onClose,
  onTestPrint,
}: PrinterSettingsModalProps) {
  const [printerName, setPrinterName] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sorat_printer_name") || "Bluetooth POS-58";
    }
    return "Bluetooth POS-58";
  });

  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("sorat_printer_width") as any) || "58mm";
    }
    return "58mm";
  });

  const [autoPrint, setAutoPrint] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sorat_auto_print") !== "false";
    }
    return true;
  });

  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleScanBluetooth = async () => {
    setScanMessage(null);
    setIsScanning(true);

    try {
      if (typeof navigator !== "undefined" && (navigator as any).bluetooth) {
        const device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            "000018f0-0000-1000-8000-00805f9b34fb", // ESC/POS print service
            "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
          ],
        });

        if (device && device.name) {
          setPrinterName(device.name);
          localStorage.setItem("sorat_printer_name", device.name);
          setScanMessage(`✓ Printer "${device.name}" successfully connected!`);
        } else {
          setScanMessage("✓ Bluetooth Printer paired!");
        }
      } else {
        // Fallback for standard mobile browsers / APKs
        setScanMessage(
          "ℹ️ Apne Phone ke Bluetooth Settings me jakar pehle Thermal Printer ko Pair karein (PIN: 0000 ya 1234). Pair hone ke baad direct print chalega!"
        );
      }
    } catch (err: any) {
      if (err.name !== "NotFoundError") {
        setScanMessage(`ℹ️ Bluetooth pairing: Phone Settings me Bluetooth open karke printer connect karein.`);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleSaveSettings = () => {
    localStorage.setItem("sorat_printer_name", printerName);
    localStorage.setItem("sorat_printer_width", paperWidth);
    localStorage.setItem("sorat_auto_print", String(autoPrint));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-sm rounded-3xl border border-amber-500/30 bg-zinc-900/95 p-5 shadow-2xl backdrop-blur-md space-y-4">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-gold grid place-items-center text-zinc-950 font-black text-lg shadow-gold">
              🖨️
            </div>
            <div>
              <h3 className="font-display text-base font-black text-zinc-100 leading-tight">
                Thermal Printer Setup
              </h3>
              <span className="text-[10px] text-zinc-400 block leading-tight">
                Bluetooth & USB POS Settings
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Printer Status Badge */}
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <div>
              <span className="text-xs font-black text-emerald-300 block leading-tight">
                {printerName || "Thermal Printer"}
              </span>
              <span className="text-[9px] text-emerald-400/80 font-mono block leading-tight">
                Bluetooth / System Ready
              </span>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase font-mono">
            READY
          </span>
        </div>

        {/* Scan & Connect Bluetooth Button */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleScanBluetooth}
            disabled={isScanning}
            className="w-full py-2.5 rounded-xl bg-gradient-gold text-zinc-950 font-black text-xs uppercase tracking-wide shadow-gold hover:brightness-110 active:scale-95 transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>🔌</span>
            <span>{isScanning ? "Scanning..." : "SCAN & PAIR BLUETOOTH PRINTER"}</span>
          </button>

          {scanMessage && (
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-2.5 text-[11px] text-amber-300 font-medium leading-relaxed">
              {scanMessage}
            </div>
          )}
        </div>

        {/* Paper Size Selector */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 block">
            Paper Roll Width (पर्चे की चौड़ाई)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaperWidth("58mm")}
              className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center ${
                paperWidth === "58mm"
                  ? "border-amber-500 bg-amber-500/15 text-amber-400 font-black shadow-sm"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span>58mm (2-Inch)</span>
              <span className="text-[9px] text-zinc-500 font-normal">Pocket Bluetooth POS</span>
            </button>

            <button
              type="button"
              onClick={() => setPaperWidth("80mm")}
              className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center ${
                paperWidth === "80mm"
                  ? "border-amber-500 bg-amber-500/15 text-amber-400 font-black shadow-sm"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span>80mm (3-Inch)</span>
              <span className="text-[9px] text-zinc-500 font-normal">Desktop Counter POS</span>
            </button>
          </div>
        </div>

        {/* Auto Print Toggle */}
        <div className="flex items-center justify-between rounded-xl bg-zinc-950 border border-zinc-800 p-2.5">
          <div>
            <span className="text-xs font-bold text-zinc-200 block">
              Auto-Print on Punch
            </span>
            <span className="text-[9px] text-zinc-500 block">
              Bet lagate hi bina puche turant parchi print karein
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAutoPrint(!autoPrint)}
            className={`w-10 h-6 rounded-full transition-colors relative p-0.5 ${
              autoPrint ? "bg-amber-500" : "bg-zinc-800"
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-zinc-950 transition-transform ${
                autoPrint ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Test Print Slip Button */}
        <button
          type="button"
          onClick={() => {
            handleSaveSettings();
            onTestPrint();
          }}
          className="w-full py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition flex items-center justify-center gap-1.5"
        >
          <span>🧾</span>
          <span>TEST PRINT ALIGNMENT SLIP</span>
        </button>

        {/* Step-by-Step Hindi Guide */}
        <div className="rounded-xl bg-zinc-950/80 border border-zinc-800/80 p-2.5 text-[10px] text-zinc-400 space-y-1">
          <span className="font-bold text-amber-400 block uppercase tracking-wider text-[9px]">
            💡 Bluetooth Printer Connect Karne Ka Tareeqa:
          </span>
          <p>1. Apne thermal printer ka power ON karein.</p>
          <p>2. Phone ke Bluetooth me jakar printer pair karein (PIN: <strong>0000</strong> ya <strong>1234</strong>).</p>
          <p>3. Pair hone ke baad yahan "Test Print" dabayein, parchi nikal aayegi!</p>
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={handleSaveSettings}
          className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition"
        >
          Done & Save
        </button>

      </div>
    </div>
  );
}
