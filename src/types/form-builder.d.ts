import React from "react";

declare module "@devcode-tech/form-builder" {
  export interface FormFieldData {
    id: string;
    type: string;
    name?: string | undefined;
    mapping?: string | undefined;
    label?: string | undefined;
    placeholder?: string | undefined;
    required?: boolean | undefined;
    min?: number | undefined;
    max?: number | undefined;
    step?: number | undefined;
    options?: Array<{ id?: string | undefined; label: string; value: string; [key: string]: unknown }> | undefined;
    conditionalLogic?: {
      dependsOn: string;
      condition: string;
      value: unknown;
    } | undefined;
    validation?: {
      min?: number | undefined;
      max?: number | undefined;
      required?: boolean | undefined;
      [key: string]: unknown;
    } | undefined;
    style?: Record<string, unknown> | undefined;
    width?: string | undefined;
    [key: string]: unknown;
  }

  export interface LayoutContainer {
    id: string;
    type?: string;
    columns?: number;
    children: string[];
    fields?: string[];
    leftFields?: string[];
    rightFields?: string[];
    [key: string]: unknown;
  }

  export interface FormDesign {
    backgroundColor?: string;
    fontFamily?: string;
    fontSize?: string;
    labelColor?: string;
    inputTextColor?: string;
    helperColor?: string;
    inputBorderColor?: string;
    brandColor?: string;
    inputFocusColor?: string;
    inputBackgroundColor?: string;
    spacing?: {
      container?: string;
      fields?: string;
      columnGap?: string;
      rowGap?: string;
      fieldSpacing?: string;
    };
    submitButton?: {
      text?: string;
      backgroundColor?: string;
      textColor?: string;
      hoverBackgroundColor?: string;
      hoverTextColor?: string;
      hoverBorderColor?: string;
    };
    [key: string]: unknown;
  }

  export interface FormBuilderSaveData {
    title?: string;
    description?: string;
    fields: FormFieldData[];
    containers: LayoutContainer[];
    design?: FormDesign;
    schema?: {
      id?: string;
      name?: string;
      title?: string;
      description?: string;
      fields: FormFieldData[];
      containers: LayoutContainer[];
      design?: FormDesign;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  export interface EditableFormBuilderProps {
    initialFormId?: string | undefined;
    onDirtyStateChange?: ((isDirty: boolean) => void) | undefined;
    onSave?: ((data: FormBuilderSaveData) => Promise<string | null | undefined> | string | null | undefined | void) | undefined;
    onUpdate?: ((formId: string, data: FormBuilderSaveData) => Promise<boolean | undefined> | boolean | undefined | void) | undefined;
    onLoad?: ((formId: string) => Promise<unknown> | unknown) | undefined;
    enableDevelopmentMode?: boolean | undefined;
    workspaceBrandColor?: string | undefined;
    enableAutoSave?: boolean | undefined;
    onAutoSave?: ((formId: string, data: FormBuilderSaveData) => Promise<unknown> | unknown) | undefined;
    ref?: React.Ref<unknown> | undefined;
    [key: string]: unknown;
  }

  export interface FormBuilderProps extends EditableFormBuilderProps {
    locale?: string | undefined;
    messages?: Record<string, unknown> | undefined;
  }

  export interface FormPreviewLiveProps {
    fields: FormFieldData[];
    containers: LayoutContainer[];
    formTitle?: string | undefined;
    formDescription?: string | undefined;
    formDesign?: FormDesign | undefined;
    previewMode?: "desktop" | "mobile" | undefined;
    workspaceBrandColor?: string | undefined;
    onUpdateContainer?: ((containers: LayoutContainer[]) => void) | undefined;
  }

  export interface LocaleProviderProps {
    children?: React.ReactNode | undefined;
    locale?: string | undefined;
    messages?: Record<string, unknown> | undefined;
  }

  export const EditableFormBuilder: React.ComponentType<EditableFormBuilderProps>;
  export const FormBuilder: React.ComponentType<FormBuilderProps>;
  export const FormPreviewLive: React.FC<FormPreviewLiveProps>;
  export const LocaleProvider: React.FC<LocaleProviderProps>;

  export function normalizeFormSchema(schema: unknown): unknown;
  export function normalizeFieldData(field: unknown): FormFieldData;
  export function generateFormId(): string;
  export function generateContainerId(): string;
  export function generateOptionId(): string;
  export function useLocale(): { locale: string; setLocale: (locale: string) => void };
  export function useTranslation(ns?: string): { t: (key: string) => string };
}



