package com.capitalflow.notification;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

public final class DetectedCandidate {
    public final String localId;
    public final String provider;
    public final String externalId;
    public final String appPackage;
    public final String occurredAt;
    public final String proposedKind;
    public final long amountMinor;
    public final String currency;
    public final String merchant;
    public final String description;
    public final double confidence;
    public final String fingerprint;
    public final String dedupeKey;
    public final List<String> reasons;
    public final String parserVersion;

    public DetectedCandidate(
        String localId,
        String provider,
        String externalId,
        String appPackage,
        String occurredAt,
        String proposedKind,
        long amountMinor,
        String currency,
        String merchant,
        String description,
        double confidence,
        String fingerprint,
        String dedupeKey,
        List<String> reasons,
        String parserVersion
    ) {
        this.localId = localId;
        this.provider = provider;
        this.externalId = externalId;
        this.appPackage = appPackage;
        this.occurredAt = occurredAt;
        this.proposedKind = proposedKind;
        this.amountMinor = amountMinor;
        this.currency = currency;
        this.merchant = merchant;
        this.description = description;
        this.confidence = confidence;
        this.fingerprint = fingerprint;
        this.dedupeKey = dedupeKey;
        this.reasons = reasons;
        this.parserVersion = parserVersion;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject value = new JSONObject();
        value.put("localId", localId);
        value.put("provider", provider);
        value.put("externalId", externalId == null ? JSONObject.NULL : externalId);
        value.put("appPackage", appPackage == null ? JSONObject.NULL : appPackage);
        value.put("occurredAt", occurredAt);
        value.put("proposedKind", proposedKind);
        value.put("amountMinor", amountMinor);
        value.put("currency", currency);
        value.put("merchant", merchant == null ? JSONObject.NULL : merchant);
        value.put("description", description == null ? JSONObject.NULL : description);
        value.put("confidence", confidence);
        value.put("fingerprint", fingerprint);
        value.put("dedupeKey", dedupeKey);
        value.put("reasons", new JSONArray(reasons));
        value.put("parserVersion", parserVersion);
        return value;
    }
}
