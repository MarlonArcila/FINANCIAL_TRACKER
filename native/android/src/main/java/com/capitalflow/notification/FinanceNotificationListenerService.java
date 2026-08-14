package com.capitalflow.notification;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.Set;

public final class FinanceNotificationListenerService extends NotificationListenerService {
    private final NotificationCandidateParser parser = new NotificationCandidateParser();

    @Override
    public void onNotificationPosted(StatusBarNotification statusBarNotification) {
        if (statusBarNotification == null || statusBarNotification.getPackageName() == null) return;
        if (getPackageName().equals(statusBarNotification.getPackageName())) return;
        Notification notification = statusBarNotification.getNotification();
        if (notification == null || (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

        NotificationQueue queue = new NotificationQueue(getApplicationContext());
        Set<String> allowed = queue.getAllowedPackages();
        String sourcePackage = statusBarNotification.getPackageName();
        // Empty allow-list means automatic discovery: parse locally and only queue financial signals.
        if (!allowed.isEmpty() && !allowed.contains(sourcePackage)) return;

        Bundle extras = notification.extras;
        String title = asString(extras == null ? null : extras.getCharSequence(Notification.EXTRA_TITLE));
        String bigText = asString(extras == null ? null : extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        String text = bigText.isEmpty() ? asString(extras == null ? null : extras.getCharSequence(Notification.EXTRA_TEXT)) : bigText;
        if (title.isEmpty() && text.isEmpty()) return;

        DetectedCandidate candidate = parser.parse(
            sourcePackage,
            statusBarNotification.getPostTime(),
            title,
            text,
            queue.getDefaultCurrency()
        );
        if (candidate != null) queue.enqueue(candidate);
    }

    private String asString(CharSequence value) {
        return value == null ? "" : value.toString();
    }
}
