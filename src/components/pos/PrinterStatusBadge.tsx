import React from "react";
import { Printer } from "lucide-react";
import { usePrinter } from "@/lib/thermalPrinter";

interface PrinterStatusBadgeProps {
  className?: string;
  showTextOnMobile?: boolean;
}

export function PrinterStatusBadge({
  className = "",
  showTextOnMobile = false,
}: PrinterStatusBadgeProps) {
  const { status, deviceName, isConnected, isConnecting, connect, disconnect } = usePrinter();

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isConnected) {
      if (confirm(`Printer is connected to "${deviceName || "POS-58"}". Do you want to disconnect?`)) {
        disconnect();
      }
      return;
    }

    await connect();
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`group relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer border ${
        isConnected
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 shadow-xs"
          : isConnecting
            ? "border-amber-500/50 bg-amber-500/10 text-amber-400 animate-pulse"
            : "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
      } ${className}`}
      title={
        isConnected
          ? `Printer Connected: ${deviceName || "POS-58"}. Tap to disconnect.`
          : "Printer Disconnected. Tap to pair Bluetooth printer."
      }
    >
      {/* Status Dot */}
      <span className="relative flex h-2 w-2">
        {isConnected && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            isConnected
              ? "bg-emerald-500"
              : isConnecting
                ? "bg-amber-500"
                : "bg-red-500"
          }`}
        ></span>
      </span>

      <Printer className="h-3.5 w-3.5" />

      {/* Label */}
      <span className={showTextOnMobile ? "inline" : "hidden sm:inline"}>
        {isConnected
          ? `Printer: ${deviceName || "Connected"}`
          : isConnecting
            ? "Connecting…"
            : "Connect Printer"}
      </span>
    </button>
  );
}
