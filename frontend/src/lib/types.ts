import type { components } from "./api-schema";

type Schemas = components["schemas"];
export type CurrentUser = Schemas["CurrentUser"];
export type BusinessLine = Schemas["BusinessLine"];
export type Product = Schemas["Product"];
export type Category = Schemas["Category"];
export type SalonService = Schemas["Service"];
export type Customer = Schemas["Customer"];
export type Staff = Schemas["Staff"];
export type InventoryItem = Schemas["InventoryItem"];
export type Sale = Schemas["Sale"];
export type Payment = Schemas["Payment"];
export type SaleCreateInput = Schemas["CreateSaleRequest"];
export type Pagination = Schemas["Pagination"];
export type IntegrationStatus = Schemas["IntegrationStatus"];
export type Page<T> = { data: T[]; pagination: Pagination };
