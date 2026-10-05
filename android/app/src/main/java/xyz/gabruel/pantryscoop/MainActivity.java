package xyz.gabruel.pantryscoop;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PantryGoogleSignInPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
