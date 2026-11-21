package br.local.agiledash;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Bluetooth clássico (SPP/RFCOMM) para adaptadores ELM327.
 * JS: Capacitor.Plugins.ElmBluetooth.list / connect / write / disconnect
 * Eventos: "data" {value}, "disconnected" {}
 */
@CapacitorPlugin(
    name = "ElmBluetooth",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class ElmBluetoothPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private BluetoothSocket socket;
    private OutputStream out;
    private Thread reader;

    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        return BluetoothAdapter.getDefaultAdapter();
    }

    @PluginMethod
    public void list(PluginCall call) {
        if (needsPermission()) { requestPermissionForAlias("bluetooth", call, "permCallback"); return; }
        doList(call);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (needsPermission()) { requestPermissionForAlias("bluetooth", call, "permCallback"); return; }
        doConnect(call);
    }

    @PermissionCallback
    private void permCallback(PluginCall call) {
        if (needsPermission()) { call.reject("Permissão de Bluetooth negada"); return; }
        if ("list".equals(call.getMethodName())) doList(call); else doConnect(call);
    }

    @SuppressLint("MissingPermission")
    private void doList(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("Este aparelho não tem Bluetooth"); return; }
        if (!a.isEnabled()) { call.reject("Ligue o Bluetooth do celular"); return; }
        JSArray arr = new JSArray();
        for (BluetoothDevice d : a.getBondedDevices()) {
            JSObject o = new JSObject();
            o.put("name", d.getName());
            o.put("address", d.getAddress());
            arr.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("devices", arr);
        call.resolve(ret);
    }

    @SuppressLint("MissingPermission")
    private void doConnect(PluginCall call) {
        String address = call.getString("address");
        if (address == null) { call.reject("Endereço não informado"); return; }
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) { call.reject("Ligue o Bluetooth do celular"); return; }
        new Thread(() -> {
            closeQuietly();
            try {
                BluetoothDevice dev = a.getRemoteDevice(address);
                a.cancelDiscovery();
                BluetoothSocket s;
                try {
                    s = dev.createRfcommSocketToServiceRecord(SPP);
                    s.connect();
                } catch (Exception first) {
                    // Muitos clones de ELM327 só conectam pelo canal 1 direto
                    Method m = dev.getClass().getMethod("createRfcommSocket", int.class);
                    s = (BluetoothSocket) m.invoke(dev, 1);
                    s.connect();
                }
                socket = s;
                out = s.getOutputStream();
                startReader(s.getInputStream());
                call.resolve();
            } catch (Exception e) {
                closeQuietly();
                call.reject("Não conectou: " + e.getMessage());
            }
        }).start();
    }

    private void startReader(InputStream in) {
        reader = new Thread(() -> {
            byte[] buf = new byte[1024];
            try {
                int n;
                while ((n = in.read(buf)) > 0) {
                    JSObject o = new JSObject();
                    o.put("value", new String(buf, 0, n, StandardCharsets.US_ASCII));
                    notifyListeners("data", o);
                }
            } catch (Exception ignored) {
            }
            boolean wasOpen = socket != null;
            closeQuietly();
            if (wasOpen) notifyListeners("disconnected", new JSObject());
        });
        reader.start();
    }

    @PluginMethod
    public void write(PluginCall call) {
        String v = call.getString("value", "");
        try {
            if (out == null) { call.reject("Não conectado"); return; }
            out.write(v.getBytes(StandardCharsets.US_ASCII));
            out.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("Falha ao enviar: " + e.getMessage());
        }
    }

    /** Abre outro app instalado (Spotify, Waze...) pelo nome do pacote */
    @PluginMethod
    public void openApp(PluginCall call) {
        String pkg = call.getString("package");
        android.content.Intent i = pkg == null ? null : getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) { call.reject("App não instalado"); return; }
        i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeQuietly();
        call.resolve();
    }

    private synchronized void closeQuietly() {
        BluetoothSocket s = socket;
        socket = null;
        out = null;
        try { if (s != null) s.close(); } catch (Exception ignored) { }
    }

    @Override
    protected void handleOnDestroy() {
        closeQuietly();
    }
}
