import React, { createContext, useContext, useEffect, useState } from "react";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import { supabase, supabaseConfigError } from "./supabaseClient";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isGuest: boolean;
  isPreview: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: AuthError | null; needsConfirmation: boolean }>;
  signInAsGuest: () => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const isPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "true";

  useEffect(() => {
    if (isPreview || supabaseConfigError) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [isPreview]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    return { error, needsConfirmation: !error && !data.session };
  };

  const signInAsGuest = async () => {
    const { error } = await supabase.auth.signInAnonymously();
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const user = session?.user ?? null;
  const isGuest = isPreview || user?.is_anonymous === true;

  return (
    <AuthContext.Provider
      value={{ session, user, isGuest, isPreview, loading, signIn, signUp, signInAsGuest, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function getDisplayName(user: User | null, isGuest: boolean): string {
  if (!user) return "";
  if (isGuest) return "Guest";
  const name = user.user_metadata?.full_name;
  if (typeof name === "string" && name.trim()) return name.trim();
  if (user.email) return user.email.split("@")[0];
  return "User";
}

export function getDisplayEmail(user: User | null, isGuest: boolean): string {
  if (!user || isGuest) return "Not signed in";
  return user.email ?? "";
}

export function getInitials(user: User | null, isGuest: boolean): string {
  if (isGuest) return "G";
  if (!user) return "?";
  const name = getDisplayName(user, false);
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
