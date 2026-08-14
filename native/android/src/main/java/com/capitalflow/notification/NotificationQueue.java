package com.capitalflow.notification;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public final class NotificationQueue {
    private static final String PREFS = "capitalflow.notification.v1";
    private static final String KEY_QUEUE = "candidate_queue";
    private static final String KEY_ALLOWED_PACKAGES = "allowed_packages";
    private static final String KEY_DEFAULT_CURRENCY = "default_currency";
    private static final int MAX_QUEUE_SIZE = 200;
    private final SharedPreferences preferences;

    public NotificationQueue(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized boolean enqueue(DetectedCandidate candidate) {
        try {
            JSONArray current = readQueue();
            for (int index = 0; index < current.length(); index++) {
                if (candidate.localId.equals(current.getJSONObject(index).optString("localId"))) return false;
            }
            current.put(candidate.toJson());
            JSONArray bounded = new JSONArray();
            int start = Math.max(0, current.length() - MAX_QUEUE_SIZE);
            for (int index = start; index < current.length(); index++) bounded.put(current.getJSONObject(index));
            preferences.edit().putString(KEY_QUEUE, bounded.toString()).apply();
            return true;
        } catch (JSONException error) {
            preferences.edit().remove(KEY_QUEUE).apply();
            return false;
        }
    }

    public synchronized JSONArray peek() {
        return readQueue();
    }

    public synchronized void acknowledge(Set<String> localIds) {
        JSONArray current = readQueue();
        JSONArray remaining = new JSONArray();
        for (int index = 0; index < current.length(); index++) {
            JSONObject item = current.optJSONObject(index);
            if (item != null && !localIds.contains(item.optString("localId"))) remaining.put(item);
        }
        preferences.edit().putString(KEY_QUEUE, remaining.toString()).apply();
    }

    public Set<String> getAllowedPackages() {
        Set<String> value = preferences.getStringSet(KEY_ALLOWED_PACKAGES, Collections.emptySet());
        return value == null ? Collections.emptySet() : new HashSet<>(value);
    }

    public void setAllowedPackages(Set<String> packages) {
        preferences.edit().putStringSet(KEY_ALLOWED_PACKAGES, new HashSet<>(packages)).apply();
    }

    public String getDefaultCurrency() {
        String value = preferences.getString(KEY_DEFAULT_CURRENCY, "COP");
        return value != null && value.matches("[A-Z]{3}") ? value : "COP";
    }

    public void setDefaultCurrency(String currency) {
        if (currency != null && currency.matches("[A-Z]{3}")) preferences.edit().putString(KEY_DEFAULT_CURRENCY, currency).apply();
    }

    private JSONArray readQueue() {
        String raw = preferences.getString(KEY_QUEUE, "[]");
        try {
            return new JSONArray(raw == null ? "[]" : raw);
        } catch (JSONException error) {
            return new JSONArray();
        }
    }
}
