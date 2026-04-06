import { Suspense } from "react";
import { login } from "./actions";
import { AuthForm } from "../auth-form";

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm mode="login" action={login} />
    </Suspense>
  );
}
