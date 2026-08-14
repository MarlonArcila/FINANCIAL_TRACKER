package com.capitalflow.notification;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class NotificationCandidateParser {
    private static final String VERSION = "android-2026-08-12.2";
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final Set<String> ZERO_DECIMAL = new HashSet<>(Arrays.asList("COP", "JPY", "KRW", "CLP", "PYG", "VND"));
    private static final String[] EXPENSE = {"compra", "pago realizado", "pagaste", "debitado", "debito", "retiro", "spent", "charged", "purchase", "withdrawal", "payment sent", "transferencia enviada"};
    private static final String[] INCOME = {"abono", "abonado", "acreditado", "consignacion", "deposito recibido", "recibiste", "transferencia recibida", "credited", "payment received", "you received", "incoming transfer"};
    private static final Pattern NOISE = Pattern.compile("otp|one[- ]time password|c[oó]digo de verificaci[oó]n|clave din[aá]mica|verification code|promoci[oó]n|oferta|cup[oó]n|saldo disponible|available balance", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern FAILURE = Pattern.compile("fallid[oa]|rechazad[oa]|declined|failed|cancelad[oa]", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern MONEY = Pattern.compile("(?:\\d{1,3}(?:[.,\\s]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?");
    private static final Pattern CONTEXT = Pattern.compile("compra|pago|debit|spent|charged|retiro|abono|acredit|recib|deposit|transfer|monto|valor|total", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern CURRENCY_NEARBY = Pattern.compile("(?<![\\p{L}\\p{N}])(?:COP|USD|EUR|GBP|MXN|CAD|BRL)(?![\\p{L}\\p{N}])|US\\$|R\\$|[$€£]", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    public DetectedCandidate parse(String appPackage, long postedAtMillis, String title, String text, String defaultCurrency) {
        String combined = joinNonBlank(title, text);
        if (combined.isEmpty() || NOISE.matcher(combined).find() || FAILURE.matcher(combined).find()) return null;
        String normalized = normalize(combined);
        Direction direction = classify(normalized);
        if (direction == null) return null;
        ParsedMoney money = parseMoney(combined, normalizeCurrency(defaultCurrency));
        if (money == null) return null;

        String merchant = inferMerchant(text, title);
        String description = sanitize(joinNonBlank(title, text), 500);
        double confidence = Math.min(0.99d, 0.45d + money.confidence * 0.30d + direction.confidence * 0.22d + (merchant == null ? 0d : 0.03d));
        if (confidence < 0.58d) return null;

        String occurredAt = iso(postedAtMillis);
        String fingerprint = sha256Hex(appPackage + "|" + postedAtMillis + "|" + description);
        String dedupeKey = sha256Hex(direction.kind + "|" + money.amountMinor + "|" + money.currency + "|" + normalize(merchant == null ? "unknown" : merchant));
        List<String> reasons = new ArrayList<>();
        reasons.add("Amount detected as " + money.raw + ".");
        reasons.add(direction.kind + " signal detected.");
        return new DetectedCandidate(
            fingerprint,
            "android_notification",
            null,
            appPackage,
            occurredAt,
            direction.kind,
            money.amountMinor,
            money.currency,
            merchant,
            description.isEmpty() ? null : description,
            Math.round(confidence * 10_000d) / 10_000d,
            fingerprint,
            dedupeKey,
            reasons,
            VERSION
        );
    }

    private Direction classify(String normalized) {
        int expense = score(normalized, EXPENSE);
        int income = score(normalized, INCOME);
        if (expense == income || (expense == 0 && income == 0)) return null;
        int difference = Math.abs(expense - income);
        return new Direction(expense > income ? "expense" : "income", Math.min(1d, 0.58d + difference * 0.09d));
    }

    private int score(String text, String[] words) {
        int score = 0;
        for (String word : words) if (text.contains(normalize(word))) score += word.contains(" ") ? 3 : 2;
        return score;
    }

    private ParsedMoney parseMoney(String text, String defaultCurrency) {
        String currency = detectCurrency(text, defaultCurrency);
        int exponent = ZERO_DECIMAL.contains(currency) ? 0 : 2;
        Matcher matcher = MONEY.matcher(text);
        ParsedMoney selected = null;
        int selectedScore = Integer.MIN_VALUE;
        while (matcher.find()) {
            String raw = matcher.group();
            BigDecimal value = parseToken(raw, exponent);
            if (value == null || value.signum() <= 0) continue;
            int start = Math.max(0, matcher.start() - 22);
            int end = Math.min(text.length(), matcher.end() + 22);
            String context = text.substring(start, end);
            int score = CURRENCY_NEARBY.matcher(context).find() ? 5 : 0;
            if (CONTEXT.matcher(context).find()) score += 3;
            try {
                long approximate = value.longValueExact();
                if (approximate >= 1900 && approximate <= 2100 && !context.matches(".*[$€£].*")) score -= 5;
            } catch (ArithmeticException ignored) {
                // Decimal values are not years.
            }
            BigDecimal minorDecimal = value.movePointRight(exponent).setScale(0, RoundingMode.HALF_UP);
            long minor;
            try {
                minor = minorDecimal.longValueExact();
            } catch (ArithmeticException error) {
                continue;
            }
            if (minor <= 0 || minor > MAX_SAFE_INTEGER) continue;
            if (score > selectedScore || (score == selectedScore && (selected == null || minor > selected.amountMinor))) {
                selectedScore = score;
                selected = new ParsedMoney(minor, currency, raw, Math.min(1d, 0.60d + Math.max(0, score) * 0.05d));
            }
        }
        return selectedScore < 0 ? null : selected;
    }

    private BigDecimal parseToken(String raw, int exponent) {
        String token = raw.replaceAll("\\s+", "");
        int dot = token.lastIndexOf('.');
        int comma = token.lastIndexOf(',');
        String normalized;
        if (dot >= 0 && comma >= 0) {
            int decimalIndex = Math.max(dot, comma);
            int trailing = token.length() - decimalIndex - 1;
            if (exponent > 0 && trailing > 0 && trailing <= 2) {
                char decimal = token.charAt(decimalIndex);
                char thousands = decimal == '.' ? ',' : '.';
                normalized = token.replace(String.valueOf(thousands), "").replace(decimal, '.');
            } else normalized = token.replace(".", "").replace(",", "");
        } else if (dot >= 0 || comma >= 0) {
            char separator = dot >= 0 ? '.' : ',';
            String[] parts = token.split(Pattern.quote(String.valueOf(separator)), -1);
            String last = parts[parts.length - 1];
            boolean decimalLike = exponent > 0 && last.length() > 0 && last.length() <= 2;
            if (decimalLike) {
                StringBuilder whole = new StringBuilder();
                for (int index = 0; index < parts.length - 1; index++) whole.append(parts[index]);
                normalized = whole + "." + last;
            } else normalized = token.replace(String.valueOf(separator), "");
        } else normalized = token;
        try {
            return new BigDecimal(normalized);
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private String detectCurrency(String text, String fallback) {
        String upper = text.toUpperCase(Locale.ROOT);
        if (containsCurrencyCode(text, "COP")) return "COP";
        if (containsCurrencyCode(text, "USD") || upper.contains("US$")) return "USD";
        if (containsCurrencyCode(text, "EUR") || text.contains("€")) return "EUR";
        if (containsCurrencyCode(text, "GBP") || text.contains("£")) return "GBP";
        if (containsCurrencyCode(text, "MXN")) return "MXN";
        if (containsCurrencyCode(text, "CAD")) return "CAD";
        if (containsCurrencyCode(text, "BRL") || upper.contains("R$")) return "BRL";
        return fallback;
    }

    private boolean containsCurrencyCode(String text, String code) {
        String pattern = "(?<![\\p{L}\\p{N}])" + Pattern.quote(code) + "(?![\\p{L}\\p{N}])";
        return Pattern.compile(pattern, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(text).find();
    }

    private String inferMerchant(String text, String title) {
        String source = text == null ? "" : text;
        Matcher match = Pattern.compile("\\b(?:en|at|comercio|merchant)\\s+([\\p{L}\\p{N}&'’._\\- ]{2,80})", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(source);
        if (match.find()) {
            String candidate = cleanMerchant(match.group(1));
            if (candidate.length() >= 2) return candidate;
        }
        if (title != null && !title.matches("(?iu).*(banco|bank|wallet|notificaci[oó]n|notification).*")) {
            String candidate = cleanMerchant(title);
            if (candidate.length() >= 2) return candidate;
        }
        return null;
    }

    private String cleanMerchant(String value) {
        return sanitize(value, 80).replaceAll("[.,;:!?]+$", "").trim();
    }

    static String sanitize(String input, int maxLength) {
        if (input == null) return "";
        String value = Normalizer.normalize(input, Normalizer.Form.NFKC)
            .replaceAll("[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}", "[EMAIL]")
            .replaceAll("(?iu)\\b(?:otp|c[oó]digo|clave|code)\\D{0,12}\\d{4,8}\\b", "[REDACTED_CODE]")
            .replaceAll("(?:\\d[ -]?){12,19}", "[REDACTED_ACCOUNT]")
            .replaceAll("\\*{2,}\\d{2,4}", "[REDACTED_ACCOUNT]")
            .replaceAll("\\s+", " ")
            .trim();
        return value.substring(0, Math.min(maxLength, value.length()));
    }

    private String normalizeCurrency(String value) {
        String normalized = value == null ? "COP" : value.trim().toUpperCase(Locale.ROOT);
        return normalized.matches("[A-Z]{3}") ? normalized : "COP";
    }

    private String normalize(String value) {
        String decomposed = Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFD);
        return decomposed.replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
    }

    private String joinNonBlank(String... values) {
        StringBuilder result = new StringBuilder();
        for (String value : values) {
            if (value == null || value.trim().isEmpty()) continue;
            if (result.length() > 0) result.append(" | ");
            result.append(value.trim());
        }
        return result.toString();
    }

    private String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder();
            for (byte item : digest) output.append(String.format(Locale.ROOT, "%02x", item));
            return output.toString();
        } catch (Exception error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
    }

    private String iso(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(millis));
    }

    private static final class Direction {
        final String kind;
        final double confidence;
        Direction(String kind, double confidence) { this.kind = kind; this.confidence = confidence; }
    }

    private static final class ParsedMoney {
        final long amountMinor;
        final String currency;
        final String raw;
        final double confidence;
        ParsedMoney(long amountMinor, String currency, String raw, double confidence) {
            this.amountMinor = amountMinor;
            this.currency = currency;
            this.raw = raw;
            this.confidence = confidence;
        }
    }
}
