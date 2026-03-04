"use client";

import {
  ConfirmationResult,
  RecaptchaVerifier,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut,
} from "firebase/auth";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { app, isFirebaseConfigured, missingFirebaseConfig } from "../lib/firebase";

const recaptchaContainerId = "phone-auth-recaptcha";
const e164PhoneNumberRegex = /^\+[1-9]\d{6,14}$/;

function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const compact = trimmed.replace(/[\s()\-.]/g, "");
  const normalized = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;

  return normalized;
}

export default function PhoneAuthSettings() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isSubmittingPhone, setIsSubmittingPhone] = useState(false);
  const [isSubmittingCode, setIsSubmittingCode] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const auth = useMemo(() => getAuth(app), []);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return;
    }

    auth.useDeviceLanguage();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setConfirmationResult(null);
      setVerificationCode("");
    });

    return () => unsubscribe();
  }, [auth]);

  useEffect(() => {
    if (!isFirebaseConfigured || authUser?.phoneNumber || recaptchaVerifierRef.current) {
      return;
    }

    const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
      size: "normal",
      callback: () => {
        setErrorMessage(null);
      },
      "expired-callback": () => {
        setStatusMessage("reCAPTCHA expired. Please verify again.");
      },
    });

    recaptchaVerifierRef.current = verifier;
    void verifier.render();

    return () => {
      verifier.clear();
      recaptchaVerifierRef.current = null;
    };
  }, [auth, authUser]);

  const handleSendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isFirebaseConfigured || !recaptchaVerifierRef.current) {
      return;
    }

    setIsSubmittingPhone(true);
    setStatusMessage(null);
    setErrorMessage(null);

    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    if (!e164PhoneNumberRegex.test(normalizedPhoneNumber)) {
      setErrorMessage("Please enter a valid phone number in international format (example: +16505553434).");
      setIsSubmittingPhone(false);
      return;
    }

    try {
      const result = await signInWithPhoneNumber(auth, normalizedPhoneNumber, recaptchaVerifierRef.current);
      setConfirmationResult(result);
      setPhoneNumber(normalizedPhoneNumber);
      setStatusMessage("Verification code sent. Check your SMS and enter the 6-digit code.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send verification code.";
      setErrorMessage(message);
    } finally {
      setIsSubmittingPhone(false);
    }
  };

  const handleVerifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmationResult) {
      return;
    }

    setIsSubmittingCode(true);
    setErrorMessage(null);

    try {
      await confirmationResult.confirm(verificationCode.trim());
      setStatusMessage("Signed in successfully.");
      setPhoneNumber("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verification failed.";
      setErrorMessage(message);
    } finally {
      setIsSubmittingCode(false);
    }
  };

  const handleSignOut = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await signOut(auth);
      setStatusMessage("Signed out.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sign out.";
      setErrorMessage(message);
    }
  };

  if (!isFirebaseConfigured) {
    return (
      <div className="modal__option">
        <h3 className="modal__section-title">Sign In</h3>
        <p className="modal__option-help mb-0">Add Firebase config values before enabling phone sign-in.</p>
        <p className="modal__option-help">
          Missing keys: {missingFirebaseConfig.length ? missingFirebaseConfig.join(", ") : "Unknown"}
        </p>
      </div>
    );
  }

  return (
    <div className="modal__option">
      <h3 className="modal__section-title">Sign In / Sign Up</h3>
      <p className="modal__option-help">
        Phone sign-in sends a one-time SMS code. Standard messaging rates may apply.
      </p>
      <p className="modal__option-help">
        Phone-only auth is convenient but less secure. Offer stronger sign-in options when possible.
      </p>

      {authUser?.phoneNumber ? (
        <>
          <p className="notice">Signed in as {authUser.phoneNumber}.</p>
          <button type="button" className="form-button-full-width form-card-font" onClick={handleSignOut}>
            Sign Out
          </button>
        </>
      ) : (
        <>
          <form onSubmit={handleSendCode} className="modal__subsettings">
            <label className="modal__subsettings-label" htmlFor="phone-number-input">
              Phone number
            </label>
            <input
              id="phone-number-input"
              type="tel"
              className="form-card-font"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="+1 650-555-3434"
              autoComplete="tel"
              required
            />
            <button
              type="submit"
              className="form-button-full-width form-card-font"
              disabled={!phoneNumber.trim() || isSubmittingPhone}
            >
              {isSubmittingPhone ? "Sending..." : "Send verification code"}
            </button>
          </form>

          <div id={recaptchaContainerId} className="recaptcha-container" />

          {confirmationResult ? (
            <form onSubmit={handleVerifyCode} className="modal__subsettings">
              <label className="modal__subsettings-label" htmlFor="verification-code-input">
                Verification code
              </label>
              <input
                id="verification-code-input"
                inputMode="numeric"
                pattern="[0-9]{6}"
                className="form-card-font"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                placeholder="123456"
                required
              />
              <button
                type="submit"
                className="form-button-full-width form-card-font"
                disabled={!verificationCode.trim() || isSubmittingCode}
              >
                {isSubmittingCode ? "Verifying..." : "Verify and sign in"}
              </button>
            </form>
          ) : null}
        </>
      )}

      {statusMessage ? <p className="notice">{statusMessage}</p> : null}
      {errorMessage ? <p className="notice">Auth error: {errorMessage}</p> : null}
    </div>
  );
}
