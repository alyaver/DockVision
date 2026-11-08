//calculates the shared password score and display state used by registration and reset-password forms.
export function getPasswordStrength(password) {
  //tracks each requirement separately so the UI can show exactly which checks passed.
  const checks = {
    length: password.length >= 8,
    longEnough: password.length >= 12,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  //counts passed checks to drive both the strength label and progress indicator.
  const score = Object.values(checks).filter(Boolean).length;
  const levels = [
    { label: "", pct: 0, color: "#ccc" },
    { label: "Very weak", pct: 16, color: "#E24B4A" },
    { label: "Weak", pct: 32, color: "#E24B4A" },
    { label: "Fair", pct: 52, color: "#EF9F27" },
    { label: "Good", pct: 72, color: "#639922" },
    { label: "Strong", pct: 88, color: "#1D9E75" },
    { label: "Very strong", pct: 100, color: "#1D9E75" },
  ];

  return {
    checks,
    score,
    //keeps an empty field unlabeled while ensuring entered passwords always receive a visible level.
    level: password.length === 0 ? levels[0] : levels[Math.max(1, score)],
  };
}

//returns the blocking password requirements shared by registration and password reset submission.
export function getPasswordRules(password) {
  //keeps the rule labels next to their checks so validation feedback stays aligned with submit eligibility.
  return [
    { label: "At least 8 characters", valid: password.length >= 8 },
    { label: "At most 64 characters", valid: password.length <= 64 },
    {
      label: "Contains at least 1 lowercase letter",
      valid: /[a-z]/.test(password),
    },
    {
      label: "Contains at least 1 uppercase letter",
      valid: /[A-Z]/.test(password),
    },
    { label: "Contains at least 1 number", valid: /\d/.test(password) },
    {
      label: "Contains at least 1 symbol",
      valid: /[!@#$%^&*]/.test(password),
    },
    {
      label: "Uses only supported password characters",
      valid: /^[A-Za-z\d!@#$%^&*]*$/.test(password),
    },
  ];
}

//maps a six-point password score to the four visual progress segments used by the forms.
export function getStrengthBarPresentation(score) {
  //groups nearby scores so the progress bar remains readable without hiding the precise score text.
  return {
    filledSegmentCount:
      score <= 2 ? 1 : score <= 3 ? 2 : score <= 4 ? 3 : 4,
    color:
      score <= 2
        ? "#E24B4A"
        : score <= 3
          ? "#EF9F27"
          : score <= 4
            ? "#639922"
            : "#1D9E75",
  };
}
