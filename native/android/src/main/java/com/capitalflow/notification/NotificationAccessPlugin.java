package com.capitalflow.notification;

import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "NotificationAccess")
public final class NotificationAccessPlugin extends Plugin {
    @PluginMethod
    public void isPermissionGranted(PluginCall call) {
        ComponentName component = new ComponentName(getContext(), FinanceNotificationListenerService.class);
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            granted = manager != null && manager.isNotificationListenerAccessGranted(component);
        } else {
            String enabled = Settings.Secure.getString(getContext().getContentResolver(), "enabled_notification_listeners");
            granted = enabled != null && enabled.contains(getContext().getPackageName());
        }
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void openPermissionSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to open notification access settings", error);
        }
    }

    @PluginMethod
    public void setAllowedPackages(PluginCall call) {
        JSArray values = call.getArray("packages");
        if (values == null) {
            call.reject("packages is required");
            return;
        }
        Set<String> packages = new HashSet<>();
        for (int index = 0; index < values.length(); index++) {
            String value = values.optString(index, "").trim();
            if (!value.isEmpty() && value.length() <= 250) packages.add(value);
        }
        new NotificationQueue(getContext()).setAllowedPackages(packages);
        call.resolve();
    }

    @PluginMethod
    public void getAllowedPackages(PluginCall call) {
        JSArray packages = new JSArray();
        for (String value : new NotificationQueue(getContext()).getAllowedPackages()) packages.put(value);
        JSObject result = new JSObject();
        result.put("packages", packages);
        call.resolve(result);
    }

    @PluginMethod
    public void setDefaultCurrency(PluginCall call) {
        String requested = call.getString("currency");
        String currency = (requested == null ? "COP" : requested).trim().toUpperCase(Locale.ROOT);
        if (!currency.matches("[A-Z]{3}")) {
            call.reject("currency must be an ISO 4217 code");
            return;
        }
        new NotificationQueue(getContext()).setDefaultCurrency(currency);
        call.resolve();
    }

    @PluginMethod
    public void peekCandidates(PluginCall call) {
        JSONArray candidates = new NotificationQueue(getContext()).peek();
        JSObject result = new JSObject();
        result.put("candidates", candidates);
        call.resolve(result);
    }

    @PluginMethod
    public void ackCandidates(PluginCall call) {
        JSArray values = call.getArray("localIds");
        if (values == null) {
            call.reject("localIds is required");
            return;
        }
        Set<String> ids = new HashSet<>();
        for (int index = 0; index < values.length(); index++) {
            String value = values.optString(index, "");
            if (!value.isEmpty()) ids.add(value);
        }
        new NotificationQueue(getContext()).acknowledge(ids);
        call.resolve();
    }
}
