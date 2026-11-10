# Guided Proposal Maker

Build a simple SaaS prototype called QuoteFlow.

The product is a no-code configurable quote and proposal builder for businesses that receive enquiries and need to quickly turn those enquiries into customized quotes.

Do NOT position or design this as a generic form builder.

The core product is:

Enquiry → Form → Logic → Recommendation → Pricing → Proposal

The prototype should be simple, polished and functional. Do not build unnecessary enterprise features.

1. PRODUCT CONCEPT

Target users:

Event rental companies

Caterers

Wedding/event businesses

Photographers

Home service businesses

Small B2B service companies

Example use case:

A catering company receives an enquiry.

Customer provides:

Event type

Guest count

Location

Cuisine

Service type

Add-ons

The business creates rules such as:

IF guest count > 200
THEN recommend "Premium Staffing"

IF event type = Wedding
THEN recommend "Wedding Decoration Package"

IF location is outside 30 km
THEN add "Travel Fee"

The system calculates the price and generates a proposal.

2. MAIN APP NAVIGATION

Create a clean left sidebar:

Dashboard

Flows

Packages

Products

Rules

Proposals

Connections

Settings

At the bottom:

Workspace switcher
User profile

3. DASHBOARD

Create a simple dashboard.

Top metrics:

New Enquiries

Quotes Created

Proposals Sent

Conversion Rate

Main section:

Recent Enquiries

Columns:

Customer
Business
Flow
Status
Estimated Value
Created
Action

Example:

Sarah Johnson
Wedding
Wedding Package
Qualified
$3,450
Today

Actions:

View
Configure
Create Proposal

4. FLOWS

This is the main builder.

Call them Flows, NOT Forms.

Page header:

"Flows"

Button:

"+ New Flow"

Example flows:

Wedding Enquiry

Catering Quote

Event Rental Quote

Landscaping Quote

Each flow has:

Name
Description
Status
Submissions
Last updated

5. FLOW BUILDER

Create a three-column builder.

LEFT:

Component library

CENTER:

Canvas

RIGHT:

Properties / Logic

Keep the UI visually simple.

6. LEFT COMPONENT LIBRARY

Group components into:

Questions

Text

Number

Email

Phone

Dropdown

Multi-select

Radio

Checkbox

Date

File Upload

Business Components

Variable

Product Selector

Package Selector

Recommendation

Calculation

Score

Output

Price Summary

Proposal

CRM Action

For the prototype, only the following need to be fully functional:

Text
Number
Dropdown
Multi-select
Variable
Recommendation
Calculation
Price Summary

Other components can be visual placeholders.

7. CANVAS

Users should drag components into the canvas.

Each component appears as a clean card.

Example:

Guest Count

Number

Required

Each card should have:

Drag handle
Component name
Short description
Duplicate
Delete

Clicking the card opens its properties in the right panel.

8. QUESTION PROPERTIES

For a Number field:

Label

Guest Count

Description

Number of people attending the event

Variable Name

guest_count

Required

Minimum

Maximum

Unit

people

The important part:

Every important input should automatically become a variable.

For example:

Guest Count → guest_count

Event Type → event_type

Location → location

Budget → budget

This variable system is the foundation for the logic engine.

9. DROPDOWN PROPERTIES

Example:

Event Type

Options:

Wedding
Corporate
Birthday
Exhibition
Other

Allow each option to have:

Label
Value

Example:

Wedding → wedding

Corporate → corporate

10. LOGIC BUILDER

This is the most important feature of the prototype.

Make it extremely easy for a non-technical person.

Do NOT require users to write code.

Do NOT show JSON.

Do NOT show programming syntax.

Create a visual rule builder.

Button:

"+ Add Rule"

When clicked, show:

WHEN

[Guest Count] [is greater than] [200]

THEN

[Recommend] [Premium Staffing]

[+ Add Action]

Example UI:

WHEN

Guest Count

is greater than

200

THEN

Recommend

Premium Staffing

Allow multiple conditions:

WHEN

[Guest Count] [>] [200]

AND

[Event Type] [equals] [Wedding]

THEN

[Recommend] [Premium Wedding Package]

11. SUPPORTED CONDITIONS

Implement these operators:

equals

does not equal

greater than

less than

greater than or equal

less than or equal

contains

is empty

is not empty

12. SUPPORTED ACTIONS

For the prototype:

Show

Hide

Recommend

Add to Quote

Remove from Quote

Set Value

Add Fee

Apply Discount

Set Score

Do not build a complicated automation system yet.

13. VISUAL RULE CARDS

Rules should appear as cards.

Example:

Rule 01

IF

Guest Count > 200

THEN

Recommend Premium Staffing

Active

[Edit] [Duplicate] [Delete]

Another:

Rule 02

IF

Location = Outside City

THEN

Add Travel Fee $150

Active

14. RULE TESTER

Add a small "Test Rules" button.

When clicked, open a modal.

Show:

Guest Count
[250]

Event Type
[Wedding]

Location
[Outside City]

Button:

"Run Test"

Result:

✓ Premium Staffing recommended

✓ Wedding Package recommended

✓ Travel Fee added

This is important because users need confidence that their logic works.

15. PACKAGES

Create a Packages section.

Example:

Wedding Premium Package

Price:

$2,500

Includes:

8 hours photography
2 photographers
Edited photos
Online gallery

Optional Add-ons:

Album — $300
Drone — $200
Same-day edit — $500

Allow:

Create Package
Edit Package
Duplicate Package
Archive Package

16. PRODUCTS / SERVICES

Create a simple product catalog.

Fields:

Name

SKU

Description

Price

Unit

Category

Active

Examples:

Premium Staffing
$250

Travel Fee
$150

Wedding Album
$300

Drone Coverage
$200

Extra Photographer
$500

17. CALCULATION BUILDER

Create a very simple no-code calculation interface.

Example:

Guest Count

×

Price Per Guest

=

Catering Total

UI:

[Guest Count]

[×]

[Price Per Guest]

[+]

[Travel Fee]

=

Total

Allow:

×

÷

For the prototype, calculations can operate on variables and fixed numbers.

Example:

guest_count × price_per_guest + travel_fee

Do not expose formulas as the primary interface.

The visual builder should be the primary interaction.

18. PRICE SUMMARY

Add a Price Summary component to the flow.

Example:

Base Package
$2,500

Premium Staffing
$250

Wedding Album
$300

Travel Fee
$150

Subtotal
$3,200

Discount
-$200

TOTAL
$3,000

The total should update automatically when rules or selections change.

19. CUSTOMER / ENQUIRY VIEW

Create a simple enquiry detail page.

Example:

Sarah & John

Wedding

December 12, 2026

250 Guests

Chennai

Status:

Qualified

Show:

Customer Information

Answers

Recommended Packages

Selected Add-ons

Price

Internal Notes

Buttons:

Edit Configuration

Create Proposal

20. PROPOSAL GENERATOR

When the user clicks:

"Create Proposal"

open a proposal preview.

Header:

Company Logo

Proposal

Prepared for:

Sarah & John

Show:

Customer requirements

Recommended package

Included services

Add-ons

Pricing

Terms

CTA:

Accept Proposal

Button:

Send Proposal

For the prototype, "Send Proposal" can simply change the status to "Sent".

21. PROPOSAL TEMPLATE

Make the proposal look premium.

Do NOT make it look like an invoice.

Use:

Large typography
Cards
Sections
Whitespace
Professional pricing summary

Include:

Proposal title

Customer

Event details

Recommended solution

What's included

Optional add-ons

Price

Next steps

22. FLOW PREVIEW

Add a "Preview" button in the Flow Builder.

This opens the customer-facing experience.

Example:

Let's plan your event.

Tell us a little about your event and we'll recommend the right package.

Event Type

[ Wedding ]

Guest Count

[ 250 ]

Event Location

[ Chennai ]

Budget

[ $3,000–$5,000 ]

[ Continue ]

The customer should never see the underlying rules.

23. IMPORTANT UX PRINCIPLE

The builder should have TWO modes.

Build Mode

For the business owner:

Forms
Variables
Rules
Products
Pricing

Preview Mode

For the customer:

Simple guided questions
Recommendations
Price
Submit

Do not expose technical concepts to the customer.

24. LOGIC UX PRINCIPLE

The rule builder is the most important part of the application.

It should feel closer to:

"If this → then that"

than programming.

Example:

IF

[Guest Count]

[is greater than]

[200]

THEN

[Recommend]

[Premium Staffing]

This should be editable entirely through dropdowns.

Allow:

Add Condition

Add Action

AND

OR

25. RULE GROUPS

Support basic groups:

ALL conditions must match

ANY condition can match

Example:

ALL

Guest Count > 200

Event Type = Wedding

THEN

Recommend Premium Wedding Package

This is enough for the prototype.

Do NOT build a complex visual node graph.

The simple rule-card approach is easier to understand and much easier to build.

26. TEMPLATE LIBRARY

Create a template selection screen when creating a Flow.

Templates:

Wedding Photography Quote

Catering Quote

Event Rental Quote

Landscaping Quote

Home Service Quote

Blank Flow

Each template should already contain:

Questions
Example products
Example rules
Example pricing

This makes the product immediately understandable.

27. SAMPLE TEMPLATE

Make "Event Rental Quote" the primary demo template.

Questions:

Event Type
Event Date
Guest Count
Venue Type
Indoor / Outdoor
Tables Required
Chairs Required
Lighting
Sound System
Stage

Products:

Standard Chair
Premium Chair
Round Table
Lighting Package
Sound Package
Stage Package
Delivery
Setup

Rules:

IF Guest Count > 200
→ Recommend Premium Sound

IF Outdoor = Yes
→ Recommend Lighting Package

IF Guest Count > 300
→ Add 10% extra chairs

IF Delivery Distance > 30 km
→ Add Delivery Fee

28. CONNECTIONS

Create a simple integrations page.

Cards:

HubSpot
Salesforce
Pipedrive
Zapier
Webhook

For prototype:

Show "Connect" buttons.

They don't need to be fully functional.

29. DESIGN SYSTEM

Use a modern B2B SaaS interface.

References:

Stripe
Linear
Figma
Notion
Attio

Avoid:

Traditional form-builder appearance
Huge colorful gradients
Excessive rounded cards
Marketing website aesthetics
Complex node graphs

Use:

Clean sidebar
Neutral background
Subtle borders
Compact cards
Strong typography
Clear hierarchy
Lots of whitespace

The builder should feel like a professional business application.

30. RESPONSIVENESS

The builder is primarily desktop.

Make the customer-facing Preview responsive for:

Desktop
Tablet
Mobile

The builder itself can prioritize desktop.

31. TECHNICAL REQUIREMENTS

Use:

React
TypeScript
Tailwind
shadcn/ui

Use local/mock data for the prototype.

No backend is required.

Persist data in localStorage so that:

Flows
Rules
Products
Packages

remain available after refresh.

Create a simple data model:

Flow

Question

Variable

Rule

Condition

Action

Product

Package

Calculation

Proposal

32. IMPORTANT SCOPE LIMIT

This is a prototype.

Do NOT build:

Authentication

Billing

Multi-tenancy

Complex permissions

Real CRM integrations

Real payment processing

Advanced workflow automation

AI agents

Full CPQ

Complex node-based workflow editor

ERP integrations

These can come later.

Focus on proving:

Build a flow

Add questions

Create variables

Create rules

Add products

Calculate price

Preview customer experience

Create proposal

33. DEMO SCENARIO

The application should work out of the box with demo data.

Create:

"Event Rental Quote"

Example customer:

Sarah Johnson

Guest Count:

250

Event:

Wedding

Outdoor:

Yes

Location:

Outside City

When the user opens the enquiry:

The system should automatically show:

Premium Sound Package

Lighting Package

Delivery Fee

Then calculate the total.

The user clicks:

Create Proposal

and sees the finished proposal.

34. PRODUCT POSITIONING IN THE UI

Use this small tagline in the application:

Turn enquiries into quotes in minutes.

Secondary text:

Collect requirements, apply your business rules, configure the right solution and send a proposal.

Do not call the product a "Form Builder" anywhere in the main navigation.

The form builder is an implementation detail.

The product is a Configurable Quote & Proposal Builder.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e756fef8-72fe-47cb-8dd0-c1939500bb85).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
