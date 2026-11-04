import {readTableFile} from "./xlsx";
import {type TableRow} from "./merged-cells";
import {catalogFromSheets,CATALOG_MERGED_HEADERS,type CatalogItem} from "./catalog";
import {childImportFromSheets,hasChildImportHeaders,CHILD_SALES_HEADERS,type ChildImport} from "./child-sku-import";

export type ProductImport={kind:"catalog";items:CatalogItem[]}|{kind:"child";input:ChildImport};

export function productImportFromSheets(sheets:{name:string;rows:TableRow[]}[]):ProductImport{
 // Detect the headers before validating rows, so a malformed child-SKU table
 // still receives its own field error instead of falling back to new products.
 return hasChildImportHeaders(sheets)?{kind:"child",input:childImportFromSheets(sheets)}:{kind:"catalog",items:catalogFromSheets(sheets)};
}

export async function parseProductImport(file:File){
 return productImportFromSheets(await readTableFile(file,{mergedHeaders:[...CATALOG_MERGED_HEADERS,...CHILD_SALES_HEADERS]}));
}
