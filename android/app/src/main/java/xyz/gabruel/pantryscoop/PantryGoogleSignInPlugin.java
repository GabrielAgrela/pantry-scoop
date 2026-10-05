package xyz.gabruel.pantryscoop;

import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/** Google's native account chooser. The server verifies the returned token and nonce. */
@CapacitorPlugin(name = "PantryGoogleSignIn")
public class PantryGoogleSignInPlugin extends Plugin {
    private CancellationSignal pending;

    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("serverClientId");
        String nonce = call.getString("nonce");
        if (clientId == null || clientId.isEmpty() || nonce == null || nonce.isEmpty()) {
            call.reject("Google sign-in is not configured. Try again after the server is updated.", "configuration");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (pending != null) {
                call.reject("Google sign-in is already open.", "in-progress");
                return;
            }
            pending = new CancellationSignal();
            GetCredentialRequest request = new GetCredentialRequest.Builder()
                .addCredentialOption(new GetSignInWithGoogleOption.Builder(clientId).setNonce(nonce).build())
                .build();
            CredentialManager.create(getActivity()).getCredentialAsync(
                getActivity(), request, pending, ContextCompat.getMainExecutor(getActivity()),
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse result) {
                        pending = null;
                        Credential credential = result.getCredential();
                        if (!(credential instanceof CustomCredential)
                            || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                            call.reject("Google returned an unsupported sign-in response.", "invalid-credential");
                            return;
                        }
                        try {
                            GoogleIdTokenCredential token = GoogleIdTokenCredential.createFrom(credential.getData());
                            JSObject data = new JSObject();
                            data.put("idToken", token.getIdToken());
                            call.resolve(data);
                        } catch (Exception error) {
                            call.reject("Google's sign-in response could not be read. Try again.", "invalid-credential");
                        }
                    }

                    @Override
                    public void onError(GetCredentialException error) {
                        pending = null;
                        if (error instanceof GetCredentialCancellationException) {
                            call.reject("Google sign-in was cancelled.", "cancelled");
                        } else if (error instanceof NoCredentialException) {
                            call.reject("Add a Google account in Android Settings, then try again.", "no-account");
                        } else {
                            call.reject("Google sign-in could not open: " + error.getMessage(), "google-sign-in");
                        }
                    }
                });
        });
    }

    @PluginMethod
    public void clearCredentialState(PluginCall call) {
        CredentialManager.create(getActivity()).clearCredentialStateAsync(
            new ClearCredentialStateRequest(), null, ContextCompat.getMainExecutor(getActivity()),
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override public void onResult(Void result) { call.resolve(); }
                @Override public void onError(ClearCredentialException error) {
                    call.reject("Google's remembered sign-in could not be cleared.", "google-sign-out");
                }
            });
    }

    @Override
    protected void handleOnDestroy() {
        if (pending != null) pending.cancel();
        super.handleOnDestroy();
    }
}
