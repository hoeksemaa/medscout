"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";

interface AuthFormProps {
  mode: "login" | "signup";
  action: (formData: FormData) => Promise<{ error: string } | void>;
}

export function AuthForm({ mode, action }: AuthFormProps) {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [state, formAction, pending] = useActionState(
    async (_prev: { error: string } | null, formData: FormData) => {
      const result = await action(formData);
      if (result && "error" in result) return result;
      return null;
    },
    null
  );

  const isLogin = mode === "login";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">MedScout</h1>
          <p className="text-sm text-muted-foreground">
            {isLogin
              ? "Sign in to your account"
              : "Create your account"}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {isLogin ? "Log in" : "Sign up"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="next" value={next} />

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder={
                    isLogin
                      ? "Enter your password"
                      : `At least ${MIN_PASSWORD_LENGTH} characters`
                  }
                  required
                  minLength={isLogin ? undefined : MIN_PASSWORD_LENGTH}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                />
              </div>

              {state?.error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {state.error}
                </div>
              )}

              <Button
                type="submit"
                disabled={pending}
                className="w-full bg-orange-500 text-white hover:bg-orange-600"
                size="lg"
              >
                {pending
                  ? isLogin
                    ? "Signing in..."
                    : "Creating account..."
                  : isLogin
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {isLogin ? (
                <>
                  Don&apos;t have an account?{" "}
                  <Link
                    href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
                    className="text-orange-600 hover:text-orange-700 font-medium"
                  >
                    Sign up
                  </Link>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <Link
                    href={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
                    className="text-orange-600 hover:text-orange-700 font-medium"
                  >
                    Log in
                  </Link>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
