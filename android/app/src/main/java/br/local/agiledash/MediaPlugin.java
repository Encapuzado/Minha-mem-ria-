package br.local.agiledash;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.KeyEvent;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * Lê e controla o que está tocando no Android (Spotify, YT Music, Deezer...), funciona offline.
 * JS: Capacitor.Plugins.Media.hasAccess / openSettings / start / control
 * Evento: "media" {title, artist, album, duration, position, playing, pkg, art?}
 */
@CapacitorPlugin(name = "Media")
public class MediaPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSessionManager msm;
    private MediaController current;
    private String lastArtKey = "";
    private boolean started = false;

    private final MediaController.Callback cb = new MediaController.Callback() {
        @Override public void onMetadataChanged(MediaMetadata m) { emit(); }
        @Override public void onPlaybackStateChanged(PlaybackState s) { pickController(); emit(); }
        @Override public void onSessionDestroyed() { pickController(); emit(); }
    };

    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsListener = list -> { pickController(); emit(); };

    private boolean hasAccessInternal() {
        return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
    }

    private ComponentName component() {
        return new ComponentName(getContext(), MediaListenerService.class);
    }

    @PluginMethod
    public void hasAccess(PluginCall call) {
        JSObject r = new JSObject();
        r.put("value", hasAccessInternal());
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasAccessInternal()) { call.reject("Sem acesso às notificações"); return; }
        main.post(() -> {
            try {
                msm = (MediaSessionManager) getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
                if (!started) {
                    msm.addOnActiveSessionsChangedListener(sessionsListener, component(), main);
                    started = true;
                }
                lastArtKey = "";
                pickController();
                emit();
                call.resolve();
            } catch (Exception e) {
                call.reject("Erro ao ler mídia: " + e.getMessage());
            }
        });
    }

    /** Prefere a sessão que está tocando; senão a primeira (mais recente). */
    private void pickController() {
        if (msm == null) return;
        List<MediaController> list;
        try { list = msm.getActiveSessions(component()); } catch (Exception e) { return; }
        MediaController best = null;
        for (MediaController c : list) {
            if (c.getPackageName().equals(getContext().getPackageName())) continue;
            PlaybackState s = c.getPlaybackState();
            if (s != null && s.getState() == PlaybackState.STATE_PLAYING) { best = c; break; }
            if (best == null) best = c;
        }
        if (best == null && current == null) return;
        if (best != null && current != null && best.getSessionToken().equals(current.getSessionToken())) return;
        if (current != null) current.unregisterCallback(cb);
        current = best;
        lastArtKey = "";
        if (current != null) current.registerCallback(cb, main);
    }

    private void emit() {
        JSObject o = new JSObject();
        MediaController c = current;
        if (c == null) { o.put("active", false); notifyListeners("media", o); return; }
        o.put("active", true);
        o.put("pkg", c.getPackageName());
        MediaMetadata m = c.getMetadata();
        if (m != null) {
            String title = m.getString(MediaMetadata.METADATA_KEY_TITLE);
            String artist = m.getString(MediaMetadata.METADATA_KEY_ARTIST);
            o.put("title", title);
            o.put("artist", artist);
            o.put("album", m.getString(MediaMetadata.METADATA_KEY_ALBUM));
            o.put("duration", m.getLong(MediaMetadata.METADATA_KEY_DURATION));
            String key = title + "|" + artist;
            if (!key.equals(lastArtKey)) {
                Bitmap b = m.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
                if (b == null) b = m.getBitmap(MediaMetadata.METADATA_KEY_ART);
                if (b == null) b = m.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
                o.put("art", b == null ? "" : toDataUrl(b));
                lastArtKey = key;
            }
        }
        PlaybackState s = c.getPlaybackState();
        if (s != null) {
            boolean playing = s.getState() == PlaybackState.STATE_PLAYING;
            long pos = s.getPosition();
            if (playing) pos += (long) ((SystemClock.elapsedRealtime() - s.getLastPositionUpdateTime()) * s.getPlaybackSpeed());
            o.put("playing", playing);
            o.put("position", pos);
        }
        notifyListeners("media", o);
    }

    private static String toDataUrl(Bitmap b) {
        int max = 320;
        if (b.getWidth() > max || b.getHeight() > max) {
            float k = Math.min((float) max / b.getWidth(), (float) max / b.getHeight());
            b = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * k), Math.round(b.getHeight() * k), true);
        }
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 82, bos);
        return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
    }

    @PluginMethod
    public void control(PluginCall call) {
        String action = call.getString("action", "toggle");
        main.post(() -> {
            MediaController c = current;
            if (c == null) {
                // Nenhum player ativo: manda a tecla "play" para o Android, que retoma o último app (ex.: Spotify)
                if ("play".equals(action) || "toggle".equals(action)) sendKey(KeyEvent.KEYCODE_MEDIA_PLAY);
                else if ("next".equals(action)) sendKey(KeyEvent.KEYCODE_MEDIA_NEXT);
                else if ("prev".equals(action)) sendKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS);
                call.resolve();
                return;
            }
            MediaController.TransportControls t = c.getTransportControls();
            PlaybackState s = c.getPlaybackState();
            boolean playing = s != null && s.getState() == PlaybackState.STATE_PLAYING;
            switch (action) {
                case "play": t.play(); break;
                case "pause": t.pause(); break;
                case "next": t.skipToNext(); break;
                case "prev": t.skipToPrevious(); break;
                case "seek": t.seekTo(call.getLong("position", 0L)); break;
                default: if (playing) t.pause(); else t.play();
            }
            call.resolve();
        });
    }

    private void sendKey(int code) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (msm != null) msm.removeOnActiveSessionsChangedListener(sessionsListener);
            if (current != null) current.unregisterCallback(cb);
        } catch (Exception ignored) { }
    }
}
