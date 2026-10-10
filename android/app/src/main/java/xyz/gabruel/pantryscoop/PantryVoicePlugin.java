package xyz.gabruel.pantryscoop;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Locale;

/** Tap-only access to the system recognizer and system TTS engine. No paid cloud SDK. */
@CapacitorPlugin(name = "PantryVoice", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class PantryVoicePlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private PluginCall pendingListen;
    private TextToSpeech tts;
    private boolean ttsReady;
    private PluginCall speechCall;
    private String utteranceId;
    private long speechSequence;

    @PluginMethod
    public void capabilities(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject data = new JSObject();
            data.put("listening", SpeechRecognizer.isRecognitionAvailable(getContext()));
            Intent intent = new Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE);
            data.put("speaking", !getContext().getPackageManager().queryIntentServices(intent, 0).isEmpty());
            call.resolve(data);
        });
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (pendingListen != null || recognizer != null) { call.reject("The microphone is already listening."); return; }
            pendingListen = call;
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                requestPermissionForAlias("microphone", call, "microphonePermission");
            } else beginListening(call);
        });
    }

    @PermissionCallback
    private void microphonePermission(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (pendingListen != call) return; // chat may have closed while permission was being requested
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                pendingListen = null;
                call.reject("Microphone access was denied. Allow it in Android app settings, then try again.");
            } else beginListening(call);
        });
    }

    private void emit(String type, String text) {
        JSObject event = new JSObject();
        event.put("type", type);
        if (type.equals("error")) event.put("message", text);
        else if (text != null) event.put("text", text);
        notifyListeners("recognition", event);
    }

    private void beginListening(PluginCall call) {
        pendingListen = null;
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Speech recognition is not installed. Enable your Android speech recognition service."); return;
        }
        try {
            SpeechRecognizer current = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer = current;
            current.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { if (recognizer == current) emit("start", null); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rms) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int type, Bundle params) {}
                private void result(Bundle data) {
                    if (recognizer != current) return;
                    ArrayList<String> words = data.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (words != null && !words.isEmpty()) emit("result", words.get(0));
                }
                @Override public void onPartialResults(Bundle data) { result(data); }
                @Override public void onResults(Bundle data) {
                    if (recognizer != current) return;
                    result(data); finishRecognition();
                }
                @Override public void onError(int code) {
                    if (recognizer != current) return;
                    String message = switch (code) {
                        case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Allow microphone access in Android app settings, then try again.";
                        case SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I didn’t hear a question. Tap the microphone and try again.";
                        case SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition could not connect. Check your connection and try again.";
                        case SpeechRecognizer.ERROR_AUDIO -> "Your microphone is unavailable. Check whether another app is using it.";
                        case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "Your speech service does not have this language available. Check Android speech settings.";
                        default -> "Speech recognition could not finish. Please try again.";
                    };
                    emit("error", message); finishRecognition();
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("lang", Locale.getDefault().toLanguageTag()));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            current.startListening(intent);
            call.resolve();
        } catch (Exception error) {
            finishRecognition(); call.reject("Speech recognition could not start. Check Android speech settings.");
        }
    }

    private void finishRecognition() {
        SpeechRecognizer current = recognizer;
        recognizer = null;
        if (current != null) current.destroy();
        emit("end", null);
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> { if (recognizer != null) recognizer.stopListening(); call.resolve(); });
    }

    @PluginMethod
    public void cancelListening(PluginCall call) {
        getActivity().runOnUiThread(() -> { cancelRecognition(); call.resolve(); });
    }

    private void cancelRecognition() {
        if (pendingListen != null) { pendingListen.reject("Voice input was cancelled."); pendingListen = null; }
        if (recognizer != null) { recognizer.cancel(); finishRecognition(); }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String text = call.getString("text", "");
            if (text.isBlank() || text.length() > TextToSpeech.getMaxSpeechInputLength()) {
                call.reject("This reply is too long to read aloud in one go."); return;
            }
            stopSpeech();
            speechCall = call;
            if (tts != null && ttsReady) { say(); return; }
            if (tts != null) return; // initialization is already in flight; say the latest request when ready
            tts = new TextToSpeech(getContext(), status -> getActivity().runOnUiThread(() -> {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (!ttsReady) {
                    if (speechCall != null) { speechCall.reject("Enable a text-to-speech engine in Android settings to hear Scoop."); speechCall = null; }
                    if (tts != null) { tts.shutdown(); tts = null; }
                } else if (speechCall != null) say();
            }));
        });
    }

    private void say() {
        int language = tts.setLanguage(Locale.forLanguageTag(speechCall.getString("lang", "en")));
        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
            speechCall.reject("Install a voice for this language in Android text-to-speech settings."); speechCall = null; return;
        }
        utteranceId = "scoop-" + (++speechSequence);
        tts.setSpeechRate(0.96f);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { completeSpeech(id, false); }
            @Override public void onError(String id) { completeSpeech(id, true); }
        });
        if (tts.speak(speechCall.getString("text"), TextToSpeech.QUEUE_FLUSH, null, utteranceId) == TextToSpeech.ERROR) completeSpeech(utteranceId, true);
    }

    private void completeSpeech(String id, boolean error) {
        getActivity().runOnUiThread(() -> {
            if (speechCall == null || !id.equals(utteranceId)) return;
            PluginCall call = speechCall; speechCall = null; utteranceId = null;
            if (error) call.reject("Scoop could not read aloud. Check Android text-to-speech settings.");
            else call.resolve();
        });
    }

    private void stopSpeech() {
        utteranceId = null;
        if (tts != null) tts.stop();
        if (speechCall != null) { speechCall.resolve(); speechCall = null; }
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        getActivity().runOnUiThread(() -> { stopSpeech(); call.resolve(); });
    }

    @Override protected void handleOnPause() {
        // A runtime permission prompt can pause the activity; let that request complete.
        getActivity().runOnUiThread(() -> { if (pendingListen == null) cancelRecognition(); stopSpeech(); });
        super.handleOnPause();
    }

    @Override protected void handleOnDestroy() {
        cancelRecognition(); stopSpeech();
        if (tts != null) { tts.shutdown(); tts = null; }
        super.handleOnDestroy();
    }
}
