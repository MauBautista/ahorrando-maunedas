package com.maubautista.maunedas.feature.tracking

import com.maubautista.maunedas.core.data.AlertType
import com.maubautista.maunedas.core.data.VariantOption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RuleFormTest {
    private val ok = RuleFormState(variant = VariantOption("v1", "Leche · 1 L", null), priceCents = 2_500)

    @Test
    fun checksARuleBeforeWritingIt() {
        assertNull(RuleForm.problem(ok))
        assertEquals(R.string.alerts_problem_variant, RuleForm.problem(ok.copy(variant = null)))
        assertEquals(R.string.alerts_problem_price, RuleForm.problem(ok.copy(priceCents = null)))
        assertEquals(R.string.alerts_problem_price, RuleForm.problem(ok.copy(priceCents = 0)))
        assertEquals(R.string.alerts_problem_pct, RuleForm.problem(ok.copy(type = AlertType.DROP_PCT, pct = "0")))
        assertEquals(R.string.alerts_problem_pct, RuleForm.problem(ok.copy(type = AlertType.DROP_PCT, pct = "101")))
        assertNull(RuleForm.problem(ok.copy(type = AlertType.DROP_PCT, pct = "100")))
        assertNull(RuleForm.problem(ok.copy(type = AlertType.DROP_PCT, pct = "12,5")))
        assertEquals(R.string.alerts_problem_cooldown, RuleForm.problem(ok.copy(cooldown = "721")))
        assertEquals(R.string.alerts_problem_cooldown, RuleForm.problem(ok.copy(cooldown = "1.5")))
        assertNull(RuleForm.problem(ok.copy(cooldown = " 0 ")))
        // A type that needs no price does not ask for one.
        assertNull(RuleForm.problem(ok.copy(type = AlertType.PROMO, priceCents = null)))
        assertEquals(12.5, RuleForm.pct("12.5")!!, 0.0)
        assertEquals(720L, RuleForm.cooldown("720"))
    }
}
