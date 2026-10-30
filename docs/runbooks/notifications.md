# CampusFind notification delivery

CampusFind currently records in-app alerts for possible matches, claim decisions, completed returns, and direct report-status changes. Students can read and mark these notifications from the Browse page.

SMS delivery remains optional and depends on the configured Twilio credentials and explicit student opt-in. Email delivery is not enabled: a verified sending domain and an email-provider API key are required before sending account notifications. Do not expose provider secrets in frontend environment variables or commit them to the repository.

A later email integration should send only non-sensitive status summaries and link students back to the authenticated My Reports page. Never include private claim proof, phone numbers, or hidden item-identification details in email.
