# DOCKV-323 Contact Manual Tests

## Environment

- Date: 11/5/2026
- Tester: Caleb Lewis
- Branch/commit: DOCKV-327-Testing-Frameworks-Contact-Submissions
- Browser: Google Chrome
- Mail provider: Gmail

## Manual verification for frontend

1. Scenario: Submit button is pressed with invalid input
    Expected Result: Error toast appears and no email is sent
    Actual Result: Pass

2. Scenario: Entering all valid inputs except for the email field
    Expected Result: Error toast w/ message saying to enter a valid email
    Actual Result: Pass

3. Scenario: Entering in all valid inputs
    Expected Result: Message toast confirming request was submitted
    Actual Result: Pass

4. Scenario: Multiple Clicks on Submit button
    Expected Result: Only one contact request is submitted and spamming it
        will result in an error toast
    Actual Result: Pass
