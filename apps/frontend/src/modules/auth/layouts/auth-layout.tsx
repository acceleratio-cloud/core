import { LogoIcon } from "@/shared/icons/logo-icon";
import Image from "next/image";
import type { ReactNode } from "react";

export const AuthLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div className="min-h-svh flex flex-col ">
      <div className="relative isolate grid flex-1 grid-rows-[1fr_auto_1fr] gap-y-6 overflow-hidden bg-[#0d0e0f]">
        <Image
          src="/auth/datacenter-centered.png"
          alt=""
          fill
          sizes="(max-aspect-ratio: 16/9) 178vh, 100vw"
          className="object-cover object-center"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-black/25 sm:bg-black/20"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-linear-to-b from-black/80 via-black/40 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-linear-to-t from-black/95 via-black/55 to-transparent"
        />
        <div className="relative z-10 flex items-end self-start p-6 text-white sm:p-8">
          <LogoIcon className="mr-2 size-7 fill-white" />
          <div className="h-6 text-lg font-medium tracking-wider">
            cceleratio<span className="text-sm">.cloud</span>
          </div>
        </div>
        <main className="relative z-10 flex min-w-0 justify-center px-4 sm:px-8">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-6 shadow-modal sm:p-8">
            {children}
          </div>
        </main>
        <div className="absolute bottom-0 left-0 right-0 z-10 self-end p-6 text-white sm:p-8">
          <p className="max-w-2xl text-lg leading-relaxed font-normal tracking-[-0.03em] text-white/75 sm:text-[clamp(2rem,2.8vw,3rem)] sm:leading-[1.15] sm:font-medium sm:text-white">
            <span className="block">Your cloud.</span>
            <span className="block sm:text-white/90">Your data. Your control.</span>
          </p>
          <p className="mt-5 hidden max-w-md text-sm leading-6 text-white/70 sm:block">
            Next-generation infrastructure. Private and secure by design.
          </p>
        </div>
      </div>
    </div>
  );
};
