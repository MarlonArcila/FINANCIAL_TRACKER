import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(webRoot, "../..");
const androidRoot = path.join(webRoot, "android");
const sourceRoot = path.join(repositoryRoot, "native/android/src/main/java/com/capitalflow/notification");
const testRoot = path.join(repositoryRoot, "native/android/src/test/java/com/capitalflow/notification");
const appId = await readAppId(path.join(webRoot, "capacitor.config.ts"));
const packagePath = appId.split(".").join(path.sep);

await assertExists(path.join(androidRoot, "app/src/main/AndroidManifest.xml"), "Run `npx cap add android` first.");
await copyDirectory(sourceRoot, path.join(androidRoot, "app/src/main/java/com/capitalflow/notification"));
await copyDirectory(testRoot, path.join(androidRoot, "app/src/test/java/com/capitalflow/notification"));
await patchManifest(path.join(androidRoot, "app/src/main/AndroidManifest.xml"));
await patchStrings(path.join(androidRoot, "app/src/main/res/values/strings.xml"));
await writeMainActivity(path.join(androidRoot, "app/src/main/java", packagePath, "MainActivity.java"), appId);
console.log(`Installed NotificationAccess for ${appId}. Run npx cap sync android, then build in Android Studio.`);

async function readAppId(configPath) {
  const environmentAppId = process.env.CAPACITOR_APP_ID?.trim();
  if (environmentAppId) return environmentAppId;
  const source = await readFile(configPath, "utf8");
  const directMatch = source.match(/appId:\s*["']([^"']+)["']/u);
  if (directMatch) return directMatch[1];
  const declarationMatch = source.match(/const\s+appId\s*=\s*[^;]*\|\|\s*["']([^"']+)["']/u);
  if (!declarationMatch) throw new Error("Could not read appId from capacitor.config.ts");
  return declarationMatch[1];
}

async function assertExists(file, hint) {
  try { await readFile(file); } catch { throw new Error(`${file} does not exist. ${hint}`); }
}

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

async function patchManifest(file) {
  let source = await readFile(file, "utf8");
  if (source.includes("FinanceNotificationListenerService")) return;
  const service = `
        <service
            android:name="com.capitalflow.notification.FinanceNotificationListenerService"
            android:label="@string/capitalflow_notification_listener_label"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
            android:exported="false">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>
`;
  if (!source.includes("</application>")) throw new Error("AndroidManifest.xml has no </application> tag");
  source = source.replace("</application>", `${service}    </application>`);
  await writeFile(file, source);
}

async function patchStrings(file) {
  let source = await readFile(file, "utf8");
  if (source.includes("capitalflow_notification_listener_label")) return;
  source = source.replace("</resources>", "    <string name=\"capitalflow_notification_listener_label\">Detección financiera de CapitalFlow</string>\n</resources>");
  await writeFile(file, source);
}

async function writeMainActivity(file, packageName) {
  await mkdir(path.dirname(file), { recursive: true });
  const source = `package ${packageName};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.capitalflow.notification.NotificationAccessPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NotificationAccessPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;
  await writeFile(file, source);
}
