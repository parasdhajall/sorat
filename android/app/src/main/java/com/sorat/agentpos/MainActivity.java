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
                webView.addJavascriptInterface(new BluetoothPrinterBridge(this, webView), "AndroidBridge");
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
