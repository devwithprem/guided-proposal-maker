import type { Flow, Package, Product, WorkspaceData, Enquiry } from "./types";

export const products: Product[] = [
  { id: "p_std_chair", name: "Standard Chair", sku: "CHR-STD", description: "Folding banquet chair", price: 4, unit: "per chair", category: "Furniture", active: true },
  { id: "p_prem_chair", name: "Premium Chair", sku: "CHR-PRM", description: "Chiavari chair with cushion", price: 9, unit: "per chair", category: "Furniture", active: true },
  { id: "p_round_table", name: "Round Table", sku: "TBL-RND", description: "Seats 8 guests", price: 18, unit: "per table", category: "Furniture", active: true },
  { id: "p_lighting", name: "Lighting Package", sku: "LGT-PKG", description: "Ambient uplighting and festoon run", price: 650, unit: "flat", category: "Production", active: true },
  { id: "p_sound", name: "Premium Sound Package", sku: "SND-PRM", description: "Line array, mixer and two wireless mics", price: 900, unit: "flat", category: "Production", active: true },
  { id: "p_stage", name: "Stage Package", sku: "STG-PKG", description: "16x12 modular stage with skirting", price: 750, unit: "flat", category: "Production", active: true },
  { id: "p_delivery", name: "Delivery Fee", sku: "LOG-DEL", description: "Outside 30 km delivery surcharge", price: 150, unit: "flat", category: "Logistics", active: true },
  { id: "p_setup", name: "Setup & Teardown", sku: "LOG-SET", description: "Crew setup and same-night teardown", price: 400, unit: "flat", category: "Logistics", active: true },
  { id: "p_staffing", name: "Premium Staffing", sku: "SRV-STF", description: "Additional event crew for large guest counts", price: 250, unit: "flat", category: "Service", active: true },
  { id: "p_album", name: "Wedding Album", sku: "PHO-ALB", description: "40 page layflat album", price: 300, unit: "flat", category: "Add-on", active: true },
  { id: "p_drone", name: "Drone Coverage", sku: "PHO-DRN", description: "Aerial video and stills", price: 200, unit: "flat", category: "Add-on", active: false },
];

export const packages: Package[] = [
  {
    id: "pk_event_rental",
    name: "Signature Event Rental Package",
    description: "Core rental setup for outdoor and marquee events up to 250 guests.",
    price: 2500,
    includes: ["Marquee and flooring", "250 premium chairs", "30 round tables", "Linens and place settings", "On-site coordinator"],
    addons: [
      { id: "a_heaters", name: "Patio heaters", price: 220 },
      { id: "a_dance", name: "Dance floor", price: 480 },
      { id: "a_bar", name: "Mobile bar", price: 650 },
    ],
    archived: false,
  },
  {
    id: "pk_wedding_premium",
    name: "Wedding Premium Package",
    description: "Full-day wedding photography coverage with two shooters.",
    price: 2500,
    includes: ["8 hours photography", "2 photographers", "Edited photos", "Online gallery"],
    addons: [
      { id: "a_album", name: "Album", price: 300 },
      { id: "a_drone", name: "Drone", price: 200 },
      { id: "a_sde", name: "Same-day edit", price: 500 },
    ],
    archived: false,
  },
  {
    id: "pk_catering_core",
    name: "Catering Core Package",
    description: "Plated three-course service with front-of-house team.",
    price: 1800,
    includes: ["Three-course menu", "Service staff", "Crockery and glassware", "Menu tasting"],
    addons: [
      { id: "a_canape", name: "Canapé hour", price: 420 },
      { id: "a_dessert", name: "Dessert table", price: 380 },
    ],
    archived: false,
  },
];

const eventRentalFlow: Flow = {
  id: "fl_event_rental",
  name: "Event Rental Quote",
  description: "Primary enquiry flow for marquee, furniture and production rentals.",
  status: "live",
  submissions: 128,
  updatedAt: "2026-08-12",
  basePackageId: "pk_event_rental",
  components: [
    {
      id: "c_event_type",
      type: "dropdown",
      label: "Event Type",
      description: "What kind of event are you planning?",
      variable: "event_type",
      required: true,
      options: [
        { id: "o1", label: "Wedding", value: "wedding" },
        { id: "o2", label: "Corporate", value: "corporate" },
        { id: "o3", label: "Birthday", value: "birthday" },
        { id: "o4", label: "Exhibition", value: "exhibition" },
        { id: "o5", label: "Other", value: "other" },
      ],
    },
    { id: "c_event_date", type: "date", label: "Event Date", description: "When is the event?", variable: "event_date", required: true },
    { id: "c_guest_count", type: "number", label: "Guest Count", description: "Number of people attending the event", variable: "guest_count", required: true, min: 10, max: 2000, unit: "people" },
    {
      id: "c_venue_type",
      type: "dropdown",
      label: "Venue Type",
      description: "Where is the event being held?",
      variable: "venue_type",
      options: [
        { id: "o1", label: "Hotel", value: "hotel" },
        { id: "o2", label: "Private estate", value: "estate" },
        { id: "o3", label: "Banquet hall", value: "hall" },
        { id: "o4", label: "Farm / garden", value: "farm" },
      ],
    },
    {
      id: "c_outdoor",
      type: "dropdown",
      label: "Indoor / Outdoor",
      description: "Is the event indoors or outdoors?",
      variable: "outdoor",
      options: [
        { id: "o1", label: "Indoor", value: "indoor" },
        { id: "o2", label: "Outdoor", value: "outdoor" },
      ],
    },
    { id: "c_tables", type: "number", label: "Tables Required", description: "Round tables needed", variable: "tables_required", unit: "tables" },
    { id: "c_chairs", type: "number", label: "Chairs Required", description: "Total seating needed", variable: "chairs_required", unit: "chairs" },
    {
      id: "c_extras",
      type: "multiselect",
      label: "Production Extras",
      description: "Select anything you would like included",
      variable: "extras",
      options: [
        { id: "o1", label: "Lighting", value: "lighting" },
        { id: "o2", label: "Sound System", value: "sound" },
        { id: "o3", label: "Stage", value: "stage" },
      ],
    },
    { id: "c_distance", type: "number", label: "Delivery Distance", description: "Distance from our depot", variable: "delivery_distance", unit: "km" },
    { id: "c_location", type: "text", label: "Event Location", description: "City or venue address", variable: "location" },
    {
      id: "c_calc_seating",
      type: "calculation",
      label: "Seating Total",
      description: "Chairs required × premium chair price",
      calculation: {
        id: "calc1",
        name: "Seating Total",
        resultVariable: "seating_total",
        terms: [
          { id: "t1", kind: "variable", variable: "chairs_required" },
          { id: "t2", kind: "number", number: 9, operator: "×" },
        ],
      },
    },
    { id: "c_price", type: "price-summary", label: "Price Summary", description: "Live quote total shown to the customer" },
  ],
  rules: [
    {
      id: "r1",
      name: "Large event sound",
      match: "all",
      active: true,
      conditions: [{ id: "c1", variable: "guest_count", operator: "gt", value: "200" }],
      actions: [{ id: "a1", type: "recommend", targetKind: "product", targetId: "p_sound" }],
    },
    {
      id: "r2",
      name: "Outdoor lighting",
      match: "all",
      active: true,
      conditions: [{ id: "c1", variable: "outdoor", operator: "equals", value: "outdoor" }],
      actions: [{ id: "a1", type: "recommend", targetKind: "product", targetId: "p_lighting" }],
    },
    {
      id: "r3",
      name: "Very large event staffing",
      match: "all",
      active: true,
      conditions: [{ id: "c1", variable: "guest_count", operator: "gt", value: "300" }],
      actions: [{ id: "a1", type: "recommend", targetKind: "product", targetId: "p_staffing" }],
    },
    {
      id: "r4",
      name: "Long distance delivery",
      match: "all",
      active: true,
      conditions: [{ id: "c1", variable: "delivery_distance", operator: "gt", value: "30" }],
      actions: [{ id: "a1", type: "add_fee", label: "Travel Fee", amount: 150 }],
    },
    {
      id: "r5",
      name: "Wedding upgrade",
      match: "all",
      active: true,
      conditions: [
        { id: "c1", variable: "event_type", operator: "equals", value: "wedding" },
        { id: "c2", variable: "guest_count", operator: "gte", value: "150" },
      ],
      actions: [{ id: "a1", type: "recommend", targetKind: "product", targetId: "p_stage" }],
    },
  ],
};

const weddingFlow: Flow = {
  id: "fl_wedding",
  name: "Wedding Enquiry",
  description: "Photography and coverage enquiries for weddings.",
  status: "live",
  submissions: 64,
  updatedAt: "2026-08-09",
  basePackageId: "pk_wedding_premium",
  components: [
    { id: "w1", type: "text", label: "Couple Names", variable: "couple_names", required: true, description: "Who are we creating this for?" },
    { id: "w2", type: "date", label: "Wedding Date", variable: "wedding_date" },
    { id: "w3", type: "number", label: "Guest Count", variable: "guest_count", unit: "people", description: "Number of people attending" },
    { id: "w4", type: "text", label: "Location", variable: "location" },
    { id: "w5", type: "price-summary", label: "Price Summary" },
  ],
  rules: [
    {
      id: "wr1",
      name: "Large wedding staffing",
      match: "all",
      active: true,
      conditions: [{ id: "c1", variable: "guest_count", operator: "gt", value: "200" }],
      actions: [{ id: "a1", type: "recommend", targetKind: "product", targetId: "p_staffing" }],
    },
  ],
};

const cateringFlow: Flow = {
  id: "fl_catering",
  name: "Catering Quote",
  description: "Menu, service style and headcount based catering quotes.",
  status: "draft",
  submissions: 21,
  updatedAt: "2026-08-04",
  basePackageId: "pk_catering_core",
  components: [
    { id: "ct1", type: "number", label: "Guest Count", variable: "guest_count", unit: "people", required: true },
    {
      id: "ct2",
      type: "dropdown",
      label: "Cuisine",
      variable: "cuisine",
      options: [
        { id: "o1", label: "South Indian", value: "south_indian" },
        { id: "o2", label: "Continental", value: "continental" },
        { id: "o3", label: "Pan Asian", value: "pan_asian" },
      ],
    },
    { id: "ct3", type: "price-summary", label: "Price Summary" },
  ],
  rules: [],
};

const landscapingFlow: Flow = {
  id: "fl_landscaping",
  name: "Landscaping Quote",
  description: "Garden design and maintenance enquiries.",
  status: "paused",
  submissions: 9,
  updatedAt: "2026-07-28",
  components: [
    { id: "l1", type: "number", label: "Garden Size", variable: "garden_size", unit: "sqm" },
    { id: "l2", type: "price-summary", label: "Price Summary" },
  ],
  rules: [],
};

const enquiries: Enquiry[] = [
  {
    id: "en_sarah",
    customer: "Sarah Johnson",
    email: "sarah.johnson@example.com",
    business: "Wedding",
    flowId: "fl_event_rental",
    status: "qualified",
    createdAt: "2026-08-14",
    eventDate: "December 12, 2026",
    location: "Chennai — Outside City",
    answers: {
      event_type: "wedding",
      event_date: "2026-12-12",
      guest_count: 250,
      venue_type: "farm",
      outdoor: "outdoor",
      tables_required: 32,
      chairs_required: 250,
      extras: ["lighting", "sound"],
      delivery_distance: 42,
      location: "Chennai",
    },
    selectedAddons: ["a_dance"],
    notes: "Sarah & John. Site visit booked for 22 Aug. Prefers warm lighting.",
  },
  {
    id: "en_arjun",
    customer: "Arjun Mehta",
    email: "arjun@northwind.co",
    business: "Corporate",
    flowId: "fl_event_rental",
    status: "new",
    createdAt: "2026-08-13",
    eventDate: "October 2, 2026",
    location: "Bengaluru",
    answers: {
      event_type: "corporate",
      guest_count: 320,
      outdoor: "indoor",
      tables_required: 40,
      chairs_required: 320,
      delivery_distance: 12,
      location: "Bengaluru",
    },
    selectedAddons: [],
    notes: "Annual sales kickoff. Budget approval pending.",
  },
  {
    id: "en_priya",
    customer: "Priya Raman",
    email: "priya.r@example.com",
    business: "Wedding",
    flowId: "fl_wedding",
    status: "quoted",
    createdAt: "2026-08-11",
    eventDate: "January 18, 2027",
    location: "Coimbatore",
    answers: { couple_names: "Priya & Karthik", guest_count: 210, location: "Coimbatore" },
    selectedAddons: ["a_album"],
    notes: "Wants a same-day edit quote as an option.",
  },
  {
    id: "en_daniel",
    customer: "Daniel Cruz",
    email: "daniel@harbourhouse.com",
    business: "Catering",
    flowId: "fl_catering",
    status: "new",
    createdAt: "2026-08-10",
    location: "Kochi",
    answers: { guest_count: 120, cuisine: "continental" },
    selectedAddons: [],
    notes: "",
  },
];

export function seedData(): WorkspaceData {
  return {
    flows: [eventRentalFlow, weddingFlow, cateringFlow, landscapingFlow],
    products,
    packages,
    enquiries,
    proposals: [
      { id: "pr_priya", enquiryId: "en_priya", status: "sent", createdAt: "2026-08-12", title: "Wedding Photography Proposal" },
    ],
  };
}

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  questions: number;
  rules: number;
  build: () => Flow;
}

let idc = 0;
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}${(idc++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function clone(flow: Flow, name: string, description: string): Flow {
  return {
    ...structuredClone(flow),
    id: uid("fl"),
    name,
    description,
    status: "draft",
    submissions: 0,
    updatedAt: new Date().toISOString().slice(0, 10),
  };
}

export const templates: FlowTemplate[] = [
  {
    id: "t_event_rental",
    name: "Event Rental Quote",
    description: "Marquee, furniture and production rentals with distance based delivery fees.",
    questions: 10,
    rules: 5,
    build: () => clone(eventRentalFlow, "Event Rental Quote", "Marquee, furniture and production rental enquiries."),
  },
  {
    id: "t_wedding",
    name: "Wedding Photography Quote",
    description: "Coverage hours, second shooter and album add-ons.",
    questions: 5,
    rules: 1,
    build: () => clone(weddingFlow, "Wedding Photography Quote", "Photography coverage enquiries for weddings."),
  },
  {
    id: "t_catering",
    name: "Catering Quote",
    description: "Headcount, cuisine and service style pricing.",
    questions: 3,
    rules: 0,
    build: () => clone(cateringFlow, "Catering Quote", "Menu and headcount based catering quotes."),
  },
  {
    id: "t_landscaping",
    name: "Landscaping Quote",
    description: "Garden size and maintenance frequency.",
    questions: 2,
    rules: 0,
    build: () => clone(landscapingFlow, "Landscaping Quote", "Garden design and maintenance enquiries."),
  },
  {
    id: "t_home",
    name: "Home Service Quote",
    description: "Property size, service type and visit frequency.",
    questions: 3,
    rules: 0,
    build: () => ({
      id: uid("fl"),
      name: "Home Service Quote",
      description: "Property size and service frequency enquiries.",
      status: "draft",
      submissions: 0,
      updatedAt: new Date().toISOString().slice(0, 10),
      components: [
        { id: uid("c"), type: "text", label: "Full Name", variable: "full_name", required: true },
        { id: uid("c"), type: "number", label: "Property Size", variable: "property_size", unit: "sqft" },
        {
          id: uid("c"),
          type: "dropdown",
          label: "Service Type",
          variable: "service_type",
          options: [
            { id: "o1", label: "Deep clean", value: "deep_clean" },
            { id: "o2", label: "Regular clean", value: "regular" },
          ],
        },
        { id: uid("c"), type: "price-summary", label: "Price Summary" },
      ],
      rules: [],
    }),
  },
  {
    id: "t_blank",
    name: "Blank Flow",
    description: "Start from an empty canvas and build your own questions and rules.",
    questions: 0,
    rules: 0,
    build: () => ({
      id: uid("fl"),
      name: "Untitled Flow",
      description: "",
      status: "draft",
      submissions: 0,
      updatedAt: new Date().toISOString().slice(0, 10),
      components: [],
      rules: [],
    }),
  },
];