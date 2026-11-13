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
    type?: string | undefined;
    columns?: number | undefined;
    columnGap?: string | undefined;
    rowGap?: string | undefined;
    children: string[];
    fields?: string[] | undefined;
    leftFields?: string[] | undefined;
    rightFields?: string[] | undefined;
  }

  export interface FormDesign {
    backgroundColor?: string | undefined;
    fontFamily?: string | undefined;
    fontSize?: string | undefined;
    labelColor?: string | undefined;
    inputTextColor?: string | undefined;
    helperColor?: string | undefined;
    inputBorderColor?: string | undefined;
    brandColor?: string | undefined;
    inputFocusColor?: string | undefined;
    inputBackgroundColor?: string | undefined;
    spacing?: {
      container?: string | undefined;
      fields?: string | undefined;
      columnGap?: string | undefined;
      rowGap?: string | undefined;
      fieldSpacing?: string | undefined;
    } | undefined;
    submitButton?: {
      text?: string | undefined;
      backgroundColor?: string | undefined;
      textColor?: string | undefined;
      hoverBackgroundColor?: string | undefined;
      hoverTextColor?: string | undefined;
      hoverBorderColor?: string | undefined;
    } | undefined;
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

  export interface FormBuilderRef {
    saveOrUpdate: () => Promise<unknown>;
    hasUnsavedChanges?: () => boolean;
    confirmCanLeave?: (confirmLeaveFn?: (message: string) => boolean) => boolean;
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
    ref?: React.Ref<FormBuilderRef> | undefined;
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



