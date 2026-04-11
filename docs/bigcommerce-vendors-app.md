# MerchMonk BigCommerce Vendors Application

## MerchMonk eCommerce Overview

MerchMonk is a BigCommerce B2B Edition eCommerce website that will allow a customer to browse blank merchandise from a variety of suppliers, use a visual designer to customize decorations for available locations on their selected product, and see an overview of cost breakdown, as well as shipping and rush options for each product. They will be able to add these products to their cart with the customization details including images they've uploaded in the visual designer to be submitted during checkout. MerchMonk will integrate with merchandise suppliers initially using the PromoStandards API, allowing retrieval of product information to fill the BigCommerce catalog and frequently check inventory to display accurate availability to customers, and submit orders to the supplier (if they are capable of accepting orders through the promostandards API). Once an order is placed, the website will allow customers to track progress of their order from the merchandise supplier, to shipment to a decorator to customize the product, and finally shipment to their desired location(s). It will feature an AI chatbot to ask questions and get product recommendations from.

## Application Overview

This is a standalone application in BigCommerce - https://developer.bigcommerce.com/docs/integrations/apps - for management of merchandise supplier vendors. This application will only be used on the store for MerchMonk only. It does not need to support app marketplace/multi-storefront.

A new vendor will be added via a BigCommerce Admin app interface form, specifying their endpoint and PromoStandards endpoint availability (v1), or allowing custom entry of API specifications (which will later map to allow for syncronization). When a vendor is added a test should confirm that the connection details are correct prior to allowing the vendor to be added. 

Once a vendor is confirmed and added, this is when a sync should happen to retrieve all of the vendors available products from their API and add them to the BigCommerce storefront. 

Product setup and configuration is especially important considering the unique use case that requires special tracking points in the product data (locations, decorations, points, etc) to provide the visual designer the information it needs to enable the customized product mockup, but also to save the specific information to a product when it is added to the cart. Understand https://developer.bigcommerce.com/docs/rest-catalog and all related API options.

This application will be the part of the website responsible for handling and updating product data, pricing, inventory, and media. When BigCommerce checks out and creates an order, this application will be responsible for submitting, monitoring status, monitoring shipment, and handling remittance advice and invoices via the 11 endpoints specified by PromoStandards. 

In addition to manual updates when a customer logs into their account on MerchMonk to view an order status or update details, the order endpoints must be checked periodically to provide the customer notification for time sensitive events such as order status change via a automated job.

## Handling Product Pricing
These requirements also create a highly complex product pricing structure that will require careful and accurate tracking to ensure all charges are accounted for from the merchandise supplier final charge total, the product markup Merck Monk charges, the varying price scales for bulk merchandise orders, the decorator fees, as well as shipping, rush fees, etc. Pricing is managed via the B2B edition Price Lists: https://developer.bigcommerce.com/docs/integrations/channels/guide#price-lists. The default storefront behavior is to write the shopper-facing sell price to price list "Default" (`price_list_id 1`) after applying the configured product markup percentage. For PromoStandards vendors that expose multiple merchandising price families, the sync uses the same routing rule across all vendors:

- price list `1`: marked-up `Net Decorated`
- price list `2`: raw `Net Blank`

If a supplier does not expose `Net Decorated`, the sync falls back to another available `Net` family for price list `1`.


## Application Infrastructure
This application will be hosted on AWS. It is initially deployed as a series of Lambda functions with an S3 site, and a PostgreSQL database. The current infrastructure is outlined in ~/Projects/merch-monk/cdk-app with this app being VendorsAppStack.

## Required Updates
1. Pricing functionality needs to be updated to use the B2B edition price lists now that it's live - see requirements above in "Handling Product Pricing".

2. Logging needs to be a focused area for implementation. CloudWatch structure, streams, RUM, and full snapshots of API calls and responses all need to have detailed logging around them. The logging system will be the source of truth for data snapshots, debugging, syncs, etc.

## Areas For Improvement
1. Ensure how all of the product data is being set up in BigCommerce is best practice. We are expanding the base product needs quite a bit for all of the customization data points and logic. Before finalizing a normalization plan, consider how all this data will work together and be used in BigCommerce from a customization and pricing structure and be sure to set up shared product options, and shared product modifiers, so that as the customer is making selections for their decorations and locations, it will be easy for another application to quickly understand how to update the price to reflect the actual final cost. 

2. Considering the additional unique features of this application, other AWS infrastructure opportunities should be identified to more cleanly manage this application, especially considering this application will need to be in constant communication with the BigCommerce ecommerce platform, as well as a separate application for the MerchMonk Headless UI for the BigCommerce store and customer order administration/management platform.

3. While this UI will only be used internally, it must be usable for a non-technical user. A basic UI library is needed to simplify the UI/UX to allow for easier management of vendors. IMPORTANT: Before selecting a UI library, ensure it is fully compatible with React 19/Next16
