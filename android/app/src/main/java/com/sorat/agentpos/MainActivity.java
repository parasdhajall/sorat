package com.sorat.agentpos;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                BluetoothPrinterBridge bridge = new BluetoothPrinterBridge(this, webView);
                webView.addJavascriptInterface(bridge, "AndroidBridge");
                webView.addJavascriptInterface(bridge, "AndroidPrinter");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
