# QuoteFlow — MVP Acceptance Testing & Manual QA Guide

> **Comprehensive, Step-by-Step Manual QA Script for Business Owners, QA Engineers & Evaluators**  
> *Fully Grounded in QuoteFlow Seed Data and System Architecture*

---

## 1. Environment Setup & Configuration

### Prerequisites
- Node.js 22.0.0 or higher
- Modern web browser (Chrome, Edge, Firefox, or Safari)
- Terminal (PowerShell, Bash, or Zsh)

### Step 1: Configure Local Authentication Secrets
QuoteFlow strictly enforces administrative authentication and signed session cookies. Create a local environment file named `.env.local` in the project root:

```ini
# .env.local (Safe local file ignored by git)
QUOTEFLOW_ADMIN_PASSCODE=YourChosenAdminPasscode123!
QUOTEFLOW_SESSION_SECRET=a-very-long-and-secure-random-string-at-least-32-chars-long
PORT=8080
```

> [!IMPORTANT]
> - Never commit `.env.local` to git.
> - `QUOTEFLOW_SESSION_SECRET` must be at least 32 characters long to ensure HMAC-SHA256 signature security.
> - If these variables are missing, QuoteFlow safely reports an authentication configuration notice on the sign-in screen without crashing.

### Step 2: Start the Development Server
```bash
npm run dev
```
Wait until the console reports:
```
➜  Local:   http://localhost:8080/
```

---

## 2. Test Execution Matrix: Automated vs. Manual

| Suite | Execution Command | Total Tests | Status |
| :--- | :--- | :--- | :--- |
| **Domain Engine & Pricing Rules** | `npx vitest run src/lib/quoteflow/__tests__/engine.test.ts` | 20 tests | **Passed** |
| **Sprint 1 Foundation** | `npx vitest run src/lib/quoteflow/__tests__/sprint1.test.ts` | 13 tests | **Passed** |
| **Sprint 3 Calculations & Rules** | `npx vitest run src/lib/quoteflow/__tests__/sprint3.test.ts` | 17 tests | **Passed** |
| **Sprint 4 Customer Quotation** | `npx vitest run src/lib/quoteflow/__tests__/sprint4.test.ts` | 30 tests | **Passed** |
| **Sprint 5 Shared Persistence** | `npx vitest run src/lib/quoteflow/__tests__/sprint5.test.ts` | 20 tests | **Passed** |
| **Sprint 5 Stabilization Architecture** | `npx vitest run src/lib/quoteflow/__tests__/sprint5_stabilization.test.ts` | 25 tests | **Passed** |
| **React External Store Regression** | `npx vitest run src/lib/quoteflow/__tests__/store_react_regression.test.tsx` | 8 tests | **Passed** |
| **All Automated Tests Combined** | `npm test` | **133 tests** | **133/133 Passed** |

---

## 3. Owner Journey: Administrative Acceptance

### Test Case 1: Admin Authentication Gate & Sign-In
1. Navigate to `http://localhost:8080/`.
2. **Expected Behavior:** The screen displays **Admin Sign In** (`http://localhost:8080/`). The sidebar and dashboard navigation are completely hidden.
3. Enter an incorrect passcode (e.g. `wrongpass`) and click **Sign In to Workspace**.
4. **Expected Behavior:** The input field shows an error in red: *"Incorrect administrator passcode."*
5. Enter the exact passcode configured in `.env.local` and click **Sign In to Workspace**.
6. **Expected Behavior:** Seamless authentication into the QuoteFlow workspace. The full sidebar appears, and the Dashboard loads showing 4 metrics cards.

### Test Case 2: Full Route Navigation Stability
Click through all navigation items in the left sidebar:
- [x] **Dashboard (`/`):** 4 metric cards, active enquiries list.
- [x] **Flows (`/flows`):** Lists 4 flows (Event Rental, Wedding, Catering, Landscaping).
- [x] **Flow Builder (`/flows/fl_event_rental`):** Opens visual form builder with steps, questions, and preview toggle.
- [x] **Enquiries (`/enquiries`):** Table showing Sarah Johnson, Arjun Mehta, Priya Raman, Daniel Cruz.
- [x] **Enquiry Detail (`/enquiries/en_sarah`):** Shows original frozen quote ($4,430), working quote editor, customer answers.
- [x] **Packages (`/packages`):** Lists 3 packages (Signature Event Rental, Wedding Premium, Catering Core).
- [x] **Products (`/products`):** Catalog table with Standard Chair, Lighting Package, Sound Package, etc.
- [x] **Rules (`/rules`):** Business rules list for all flows.
- [x] **Proposals (`/proposals`):** Lists issued proposals.
- [x] **Connections (`/connections`):** Webhooks and integrations.
- [x] **Settings (`/settings`):** Business name, currency, deposit percent, terms.
- **Expected Result:** Instant, flicker-free navigation without any console errors or infinite loops.

### Test Case 3: Admin Catalog Price Modification & Concurrency Safety
1. Navigate to `http://localhost:8080/products`.
2. Locate `Standard Chair` (`p_std_chair`, base price $4.00).
3. Click to edit and change the price from `$4.00` to `$6.50`.
4. Refresh the browser page (`F5`).
5. **Expected Result:** The price remains `$6.50`. The change was written to SQLite and reloaded from the server.
6. Check Sarah Johnson's historical quote in `http://localhost:8080/enquiries/en_sarah`.
7. **Expected Result:** Sarah's quote snapshot is **unaffected** and remains unchanged.

---

## 4. Customer Journey: Interactive Quotation Form

### Test Case 4: Straightforward Quotation & Required Validation
1. Open an incognito browser window (simulating Customer Browser B).
2. Navigate to `http://localhost:8080/embed/fl_event_rental`.
3. **Expected Behavior:** The hosted customer form loads in a clean container without any admin sidebar.
4. On Step 1 (Your details), leave all fields blank and click **Continue**.
5. **Expected Behavior:** Validation error notices appear under required fields ("Full name is required", "Valid email is required").
6. Fill in:
   - Full name: `Alex Morgan`
   - Email: `alex.morgan@example.com`
   - Phone: `555-0144`
   - Company / Event: `Morgan Anniversary`
7. Click **Continue**.

### Test Case 5: Dynamic Rules, Conditional Questions & Calculations
1. On Step 2 (About the event):
   - Event Type: Select **Wedding**
   - Event Date: Enter `2026-11-20`
   - Guest Count: Enter `120`
   - Indoor / Outdoor: Select **Indoor**
   - Delivery Distance: Enter `15`
2. **Observe Price Sidebar:**
   - Base Package: *Signature Event Rental Package ($2,500.00)*
   - Total: **$2,500.00**
   - Recommended Products: None (rules require outdoor or >200 guests).
3. Now change **Indoor / Outdoor** to **Outdoor**:
   - **Expected Behavior:** Rule `r2` fires instantly. **Lighting Package ($650.00)** appears in the recommendations panel with an "+ Add" button. Total remains $2,500.00 (not charged until selected).
4. Now change **Guest Count** from `120` to `250`:
   - **Expected Behavior:**
     - Rule `r1` fires: **Premium Sound Package ($900.00)** appears in recommendations.
     - Rule `r5` fires (Wedding + >=150 guests): **Stage Package ($750.00)** appears in recommendations.
5. Now change **Delivery Distance** from `15` to `45`:
   - **Expected Behavior:** Rule `r4` fires: **Travel Fee ($150.00)** is automatically added as a line item.
   - Quote Total becomes **$2,650.00**.

### Test Case 6: Interactive Recommendations & Quantity Multiplication
1. In the recommendations box, click **+ Add** on **Lighting Package**.
   - **Expected Behavior:** Total increases by $650 to **$3,300.00**.
   - The Lighting Package card changes to a selected state showing a quantity stepper `[ - ] [ 1 ] [ + ]`.
2. Click the **[ + ]** button to increase quantity to `2`.
   - **Expected Behavior:** Total increases by another $650 to **$3,950.00**.
   - Line item reflects `2 × $650.00 (flat) = $1,300.00`.
3. Under "Optional package add-ons", check **Dance floor (+$480.00)**.
   - **Expected Behavior:** Total becomes **$4,430.00**.
4. Click **Get my quote** (Submit).
5. **Expected Behavior:** Form submits to server function. Confirmation screen appears:
   *"Thank you — we're on it. Your estimated quote is $4,430.00."*

---

## 5. End-to-End Deal Closing: Quote to Proposal Acceptance

### Test Case 7: Admin Review & Proposal Approval
1. Switch back to Browser A (Admin window) at `http://localhost:8080/enquiries`.
2. Refresh the page or wait for focus sync.
3. **Expected Behavior:** `Alex Morgan` appears at the top of the enquiries list with status `new` and value **$4,430.00**.
4. Click on `Alex Morgan` to open enquiry details.
5. In the Working Quote section, add a note: *"Approved 5% preferred client concession."*
6. Click **Approve & Issue Proposal**.
7. **Expected Behavior:**
   - Status transitions to `quoted`.
   - A proposal is generated with an unguessable share URL: `http://localhost:8080/p/<secure-token>`.
   - The share URL is displayed with a "Copy Link" button.

### Test Case 8: Customer Proposal Sign-Off
1. Copy the share URL and open it in Browser B (incognito window).
2. **Expected Behavior:** The formal proposal page opens displaying:
   - Event Rental details, itemized lines, subtotal $4,430.00.
   - Expiration countdown (Valid for 14 days).
   - Terms and acceptance section.
3. Scroll to the bottom to **Accept Proposal**.
4. Enter signer name: `Alex Morgan`.
5. Click **Accept & Sign Proposal**.
6. **Expected Behavior:**
   - Success banner appears: *"Proposal Accepted — Thank you! We look forward to working with you."*
   - Acceptance controls are replaced with confirmation timestamp.
7. Switch to Admin Browser A and refresh `http://localhost:8080/proposals`.
8. **Expected Behavior:** The proposal reflects status **accepted**, and the enquiry in `/enquiries` automatically reflects status **won**.

---

## 6. Edge Cases, Failure Handling & Persistence Verification

### Test Case 9: Server Restart & Full State Persistence
1. Stop the running dev server in the terminal (`Ctrl+C`).
2. Verify the terminal is closed.
3. Restart the server:
   ```bash
   npm run dev
   ```
4. Refresh `http://localhost:8080/enquiries` and `http://localhost:8080/proposals`.
5. **Expected Result:** Alex Morgan's accepted proposal and enquiry are fully intact. The SQLite database `.data/quoteflow.db` preserved all state across restarts.

### Test Case 10: Multi-Instance Brute-Force Rate Limiting
1. Open an incognito browser window and navigate to `http://localhost:8080/`.
2. Click "Sign out" if logged in.
3. Rapidly enter incorrect passcodes 5 times.
4. **Expected Result:** On the 5th attempt, the system locks out and displays:
   *"Too many failed login attempts. Account locked for 15 minutes."*
5. Even if you restart the server, the lockout persists in the SQLite `auth_rate_limits` table.

### Test Case 11: Safe Workspace Reset
1. In the admin UI, navigate to `http://localhost:8080/settings`.
2. Scroll to the Danger Zone: **Reset Workspace to Default Seed**.
3. Click **Reset Workspace**.
4. **Expected Result:**
   - A point-in-time backup snapshot is automatically created in `workspace_backups` table with reason `pre_reset`.
   - The workspace resets safely to default seed data without corrupting database integrity.
