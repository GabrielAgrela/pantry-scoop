package xyz.gabruel.pantryscoop;

import static org.junit.Assert.*;
import android.graphics.Bitmap;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs against the packaged app: real WebView, Capacitor bridge and native HTTPS transport. */
@RunWith(AndroidJUnit4.class)
public class SharedAppTest {
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value); done.countDown();
        }));
        assertTrue("WebView evaluation timed out", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    @Test public void bundledFrontendUsesNativeTransportAndShowsSignIn() throws Exception {
        try (ActivityScenario<MainActivity> app = ActivityScenario.launch(MainActivity.class)) {
            String state = "";
            for (int i = 0; i < 60; i++) {
                state = evaluate(app, "document.getElementById('view-login')?.innerText || ''");
                if (state.contains("Continue with Google")) break;
                Thread.sleep(500);
            }
            assertTrue("Shared native login did not render: " + state, state.contains("Continue with Google"));
            assertTrue(state.contains("Continue with ChatGPT"));
            assertTrue(state.contains("Use a phone sign-in link"));
            assertEquals("true", evaluate(app, "window.Capacitor.isNativePlatform()"));
            assertEquals("true", evaluate(app, "window.Capacitor.isPluginAvailable('Camera')"));
            assertEquals("\"https://localhost/\"", evaluate(app, "location.origin + location.pathname"));

            evaluate(app, "import('/js/platform.js').then(async ({platform}) => { const r = await platform.request('/api/auth/config'); window.__nativeQa = {native:platform.native,status:r.status,data:await r.json()}; }).catch(e => window.__nativeQa={error:e.message})");
            String transport = "";
            for (int i = 0; i < 40; i++) {
                transport = evaluate(app, "JSON.stringify(window.__nativeQa || null)");
                if (transport.contains("status") || transport.contains("error")) break;
                Thread.sleep(500);
            }
            assertTrue("Native HTTP did not reach the shared backend: " + transport, transport.contains("200"));
            assertTrue(transport.contains("native"));

            // Preserve a screenshot of the actual installed APK, rather than a web mockup.
            Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            File output = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null), "android-login.png");
            try (FileOutputStream stream = new FileOutputStream(output)) { image.compress(Bitmap.CompressFormat.PNG, 100, stream); }
        }
    }
}
