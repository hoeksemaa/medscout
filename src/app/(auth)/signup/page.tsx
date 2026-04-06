import { Suspense } from "react";
import { signup } from "./actions";
import { AuthForm } from "../auth-form";

export default function SignupPage() {
  return (
    <Suspense>
      <AuthForm mode="signup" action={signup} />
    </Suspense>
  );
}
