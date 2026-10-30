# ADR 0003: Phone OTP authentication

## Context
CampusFind no longer uses Chandigarh University email addresses or passwords as the sign-in identifier. Students should verify a mobile number with a one-time SMS code.

## Decision
Use Supabase Auth phone OTP. Sign-in requests use `shouldCreateUser: false`; account creation includes the normalized UID and full name in Auth user metadata. Create the public profile only after Supabase confirms the phone, and continue to enforce unique UIDs in `public.profiles`.

## Security and operational notes
- An SMS OTP proves control of a phone number; by itself it does not prove current enrollment at Chandigarh University. A trusted university roster/API would be needed for authoritative student eligibility checks.
- Supabase Auth phone provider and an SMS provider must be configured, with suitable rate limits and CAPTCHA, before real SMS delivery can be considered production-ready.
- Existing email-based accounts do not automatically have a verified phone number. They must be migrated through a trusted account-linking process; do not let a new phone account claim an existing UID.
- Never store OTPs or passwords in CampusFind tables. Let Supabase Auth issue and verify codes.
