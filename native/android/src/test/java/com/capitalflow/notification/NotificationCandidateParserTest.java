package com.capitalflow.notification;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public final class NotificationCandidateParserTest {
    private final NotificationCandidateParser parser = new NotificationCandidateParser();

    @Test
    public void parsesCopExpense() {
        DetectedCandidate candidate = parser.parse("com.wallet", 1_700_000_000_000L, "Compra aprobada", "Pagaste $45.900 en Mercado Uno", "COP");
        assertNotNull(candidate);
        assertEquals("expense", candidate.proposedKind);
        assertEquals(45_900L, candidate.amountMinor);
        assertEquals("COP", candidate.currency);
    }

    @Test
    public void parsesUsdIncomeInMinorUnits() {
        DetectedCandidate candidate = parser.parse("com.wallet", 1_700_000_000_000L, "Payment received", "You received USD 1,234.56", "USD");
        assertNotNull(candidate);
        assertEquals("income", candidate.proposedKind);
        assertEquals(123_456L, candidate.amountMinor);
    }

    @Test
    public void rejectsOtpAndFailedPayments() {
        assertNull(parser.parse("com.bank", 1L, "Código de verificación", "Tu código OTP es 123456", "COP"));
        assertNull(parser.parse("com.bank", 1L, "Pago rechazado", "Compra fallida por $20.000", "COP"));
    }
}
