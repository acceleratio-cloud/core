"use client"

import { useState, type FormEvent } from "react"

import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/shared/components/ui/field"
import { Input } from "@/shared/components/ui/input"
import { Select } from "@/shared/components/ui/select"
import { SettingsActions } from "../components/settings-actions"
import { SettingsSection } from "../components/settings-section"

export const AiProviderSettings = () => {
  const [saved, setSaved] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaved(true)
  }

  return (
    <SettingsSection
      id="ai-provider"
      title="AI provider"
      description="Connect the model provider the console sends requests to."
    >
      <form onSubmit={handleSubmit} onChange={() => setSaved(false)}>
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="ai-provider">Provider</FieldLabel>
              <Select id="ai-provider" name="provider" defaultValue="openai">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="azure">Azure OpenAI</option>
                <option value="custom">Custom (OpenAI-compatible)</option>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="ai-model">Default model</FieldLabel>
              <Input
                id="ai-model"
                name="model"
                placeholder="gpt-4.1"
                autoComplete="off"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="ai-base-url">Base URL</FieldLabel>
            <Input
              id="ai-base-url"
              name="base_url"
              placeholder="https://api.openai.com/v1"
              autoComplete="url"
            />
            <FieldDescription>
              Leave empty to use the provider default.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="ai-api-key">API key</FieldLabel>
            <Input
              id="ai-api-key"
              name="api_key"
              type="password"
              placeholder="sk-..."
              autoComplete="new-password"
            />
            <FieldDescription>
              Stored on the control plane and used for provider requests.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <SettingsActions saved={saved} />
      </form>
    </SettingsSection>
  )
}
