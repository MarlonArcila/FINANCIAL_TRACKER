#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
package_dir="$work_dir/com/capitalflow/notification"
mkdir -p "$package_dir"
cp "$repo_root/native/android/src/main/java/com/capitalflow/notification/NotificationCandidateParser.java" "$package_dir/"

cat > "$package_dir/DetectedCandidate.java" <<'JAVA'
package com.capitalflow.notification;

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

  public DetectedCandidate(String localId, String provider, String externalId, String appPackage,
      String occurredAt, String proposedKind, long amountMinor, String currency, String merchant,
      String description, double confidence, String fingerprint, String dedupeKey,
      List<String> reasons, String parserVersion) {
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
}
JAVA

cat > "$package_dir/ParserSmokeTest.java" <<'JAVA'
package com.capitalflow.notification;

public final class ParserSmokeTest {
  public static void main(String[] args) {
    NotificationCandidateParser parser = new NotificationCandidateParser();

    DetectedCandidate cop = parser.parse(
        "com.wallet", 1700000000000L, "Compra aprobada",
        "Pagaste $45.900 en Mercado Uno", "COP");
    require(cop != null
        && "expense".equals(cop.proposedKind)
        && cop.amountMinor == 45900L
        && "COP".equals(cop.currency), "COP expense and currency-boundary regression");

    DetectedCandidate usd = parser.parse(
        "com.wallet", 1700000000000L, "Payment received",
        "You received USD 1,234.56", "USD");
    require(usd != null
        && "income".equals(usd.proposedKind)
        && usd.amountMinor == 123456L, "USD income");

    require(parser.parse(
        "com.bank", 1L, "Codigo de verificacion",
        "Tu codigo OTP es 123456", "COP") == null, "OTP rejection");

    require(parser.parse(
        "com.bank", 1L, "Pago rechazado",
        "Compra fallida por $20.000", "COP") == null, "failed payment rejection");

    System.out.println("Android parser smoke tests passed: 4");
  }

  private static void require(boolean condition, String label) {
    if (!condition) throw new AssertionError(label);
  }
}
JAVA

javac -d "$work_dir/out" $(find "$work_dir/com" -name '*.java' -print)
java -cp "$work_dir/out" com.capitalflow.notification.ParserSmokeTest
