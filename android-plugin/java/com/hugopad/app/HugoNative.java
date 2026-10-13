package com.hugopad.app;

import android.content.Context;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Native bridge:
 *  - run(): execute the bundled Hugo binary (packaged as jniLibs/<abi>/libhugo.so)
 *  - startServer()/stopServer(): tiny localhost HTTP server to preview the built site in a WebView iframe
 */
@CapacitorPlugin(name = "HugoNative")
public class HugoNative extends Plugin {

    private ServerSocket serverSocket = null;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    @PluginMethod
    public void info(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("filesDir", ctx.getFilesDir().getAbsolutePath());
        ret.put("cacheDir", ctx.getCacheDir().getAbsolutePath());
        ret.put("nativeLibraryDir", ctx.getApplicationInfo().nativeLibraryDir);
        ret.put("hugoBin", new File(ctx.getApplicationInfo().nativeLibraryDir, "libhugo.so").getAbsolutePath());
        String version = "";
        try {
            version = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Exception ignored) {
        }
        ret.put("appVersion", version);
        call.resolve(ret);
    }

    @PluginMethod
    public void run(PluginCall call) {
        final String bin = call.getString("bin", "");
        final JSArray argsArr = call.getArray("args", new JSArray());
        final long timeoutMs = call.getInt("timeoutMs", 600) * 1000L;

        final Context ctx = getContext();
        pool.execute(() -> {
            Process p = null;
            JSObject ret = new JSObject();
            try {
                if (bin == null || bin.isEmpty() || !new File(bin).canExecute()) {
                    ret.put("code", -1);
                    ret.put("out", "找不到 Hugo 可执行文件: " + bin + "\n（请使用 GitHub Actions 构建的 APK，内置 hugo）");
                    call.resolve(ret);
                    return;
                }
                ProcessBuilder pb = new ProcessBuilder();
                pb.command(buildCmd(bin, argsArr));
                pb.redirectErrorStream(true);
                Map<String, String> env = pb.environment();
                env.put("HOME", ctx.getFilesDir().getAbsolutePath());
                env.put("TMPDIR", ctx.getCacheDir().getAbsolutePath());
                p = pb.start();

                final Process proc = p;
                final ScheduledFuture<?> watchdog = scheduler.schedule(() -> {
                    try {
                        proc.destroyForcibly();
                    } catch (Exception ignored) {
                    }
                }, timeoutMs, TimeUnit.MILLISECONDS);

                String out = readAll(proc.getInputStream(), 2 * 1024 * 1024);
                int code = proc.waitFor();
                watchdog.cancel(false);
                ret.put("code", code);
                ret.put("out", out);
                call.resolve(ret);
            } catch (Exception e) {
                ret.put("code", -1);
                ret.put("out", String.valueOf(e));
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void startServer(PluginCall call) {
        final String root = call.getString("root", "");
        try {
            stopServerSocket();
            final File rootDir = new File(root);
            if (!rootDir.isDirectory()) {
                call.reject("预览目录不存在: " + root + "（请先构建）");
                return;
            }
            serverSocket = new ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"));
            final ServerSocket ss = serverSocket;
            Thread t = new Thread(() -> {
                while (!ss.isClosed()) {
                    try {
                        Socket s = ss.accept();
                        pool.execute(() -> handleRequest(s, rootDir));
                    } catch (IOException e) {
                        break;
                    }
                }
            });
            t.setDaemon(true);
            t.start();
            JSObject ret = new JSObject();
            ret.put("port", ss.getLocalPort());
            ret.put("url", "http://127.0.0.1:" + ss.getLocalPort());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("启动预览服务失败: " + e);
        }
    }

    @PluginMethod
    public void stopServer(PluginCall call) {
        try {
            stopServerSocket();
        } catch (Exception ignored) {
        }
        call.resolve(new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        try {
            stopServerSocket();
        } catch (Exception ignored) {
        }
        super.handleOnDestroy();
    }

    // ---------- internals ----------

    private void stopServerSocket() throws IOException {
        if (serverSocket != null && !serverSocket.isClosed()) {
            serverSocket.close();
        }
        serverSocket = null;
    }

    private static java.util.List<String> buildCmd(String bin, JSArray args) throws Exception {
        java.util.ArrayList<String> cmd = new java.util.ArrayList<>();
        cmd.add(bin);
        if (args != null) {
            for (int i = 0; i < args.length(); i++) {
                Object o = args.get(i);
                if (o != null) cmd.add(String.valueOf(o));
            }
        }
        return cmd;
    }

    private static String readAll(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            if (bos.size() < limit) bos.write(buf, 0, n);
        }
        return bos.toString("UTF-8");
    }

    private static void handleRequest(Socket s, File root) {
        try {
            s.setSoTimeout(10000);
            java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(s.getInputStream(), "UTF-8"));
            String line = reader.readLine();
            if (line == null || !line.startsWith("GET ")) {
                s.close();
                return;
            }
            String path = line.substring(4, line.lastIndexOf(' ')).split("\\?")[0].split("#")[0];
            // drain headers
            int empty = 0;
            while (empty < 512) {
                String hl = reader.readLine();
                if (hl == null || hl.isEmpty()) break;
                empty++;
            }
            path = URLDecoder.decode(path, "UTF-8");
            if (path.contains("..")) path = "/";

            File f = new File(root, path.equals("/") ? "index.html" : path.substring(1));
            if (f.isDirectory()) f = new File(f, "index.html");
            boolean is404 = false;
            if (!f.isFile() && !path.equals("/")) {
                File tryHtml = new File(root, path.substring(1) + ".html");
                if (tryHtml.isFile()) f = tryHtml;
                else { is404 = true; f = new File(root, "404.html"); }
            }

            byte[] body = new byte[0];
            int status = 200;
            if (f.isFile() && f.getCanonicalPath().startsWith(root.getCanonicalPath())) {
                body = readFile(f);
            } else {
                status = 404;
                body = ("<html><body><h1>404</h1><p>" + escHtml(path) + "</p></body></html>").getBytes("UTF-8");
                if (is404) status = 404;
            }
            OutputStream os = s.getOutputStream();
            String head = "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : "Not Found") + "\r\n"
                    + "Content-Type: " + mimeOf(f.getName()) + "\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n\r\n";
            os.write(head.getBytes("UTF-8"));
            os.write(body);
            os.flush();
            s.close();
        } catch (Exception ignored) {
            try {
                s.close();
            } catch (IOException ignored2) {
            }
        }
    }

    private static byte[] readFile(File f) throws IOException {
        FileInputStream fis = new FileInputStream(f);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = fis.read(buf)) > 0) bos.write(buf, 0, n);
        fis.close();
        return bos.toByteArray();
    }

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("htm", "text/html; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("js", "application/javascript; charset=utf-8");
        MIME.put("mjs", "application/javascript; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("txt", "text/plain; charset=utf-8");
        MIME.put("md", "text/markdown; charset=utf-8");
        MIME.put("xml", "application/xml; charset=utf-8");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("webp", "image/webp");
        MIME.put("avif", "image/avif");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
        MIME.put("pdf", "application/pdf");
        MIME.put("mp4", "video/mp4");
        MIME.put("webm", "video/webm");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("wasm", "application/wasm");
    }

    private static String mimeOf(String name) {
        int i = name.lastIndexOf('.');
        String ext = i >= 0 ? name.substring(i + 1).toLowerCase(Locale.US) : "";
        String m = MIME.get(ext);
        return m != null ? m : "application/octet-stream";
    }

    private static String escHtml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
