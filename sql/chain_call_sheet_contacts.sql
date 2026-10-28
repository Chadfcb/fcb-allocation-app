-- sql/chain_call_sheet_contacts.sql  (2026-10-28)
-- Loads the buyer / store contacts from "Chain Store Call Sheet.xlsx" (2025 calls)
-- into Sales -> Accounts contacts (sales_account_contacts), source 'Chain Call Sheet'.
--   * Grocery Outlet + Total Wine stores matched by VIP outlet id.
--   * BevMo stores matched by store number (the sheet's numbers are BevMo loc #s, not VIP ids).
--   * A contact with the same name already on that account is NOT added again;
--     only its blank title / phone / email / notes get filled in.
--   * Store phone on the account is filled only where it is blank.
--   * Save Mart tab had no contact info; BevMo #6 is marked CLOSED -> skipped.
-- Safe to run more than once. Ends with a summary of what changed and anything not matched.

drop table if exists pg_temp._ccs_contacts;
drop table if exists pg_temp._ccs_phones;
create temp table _ccs_contacts (chain text, store text, storeno text, outlet text, name text, title text, phone text, email text, notes text);
create temp table _ccs_phones (chain text, store text, storeno text, outlet text, phone text);

insert into _ccs_contacts values
  ('BevMo', 'BEVMO! #118', '118', '', 'Store', 'Store line', '(831) 475-1139', 'loc-785@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #148', '148', '', 'Store', 'Store line', '(209) 367-1024', 'loc-1450@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #46', '46', '', 'Store', 'Store line', '(209) 545-3320', 'loc-784@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #162', '162', '', 'Store', 'Store line', '(209) 315-6428', 'loc-519@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #150', '150', '', 'Store', 'Store line', '(209) 836-3732', 'loc-1021@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #60', '60', '', 'Store', 'Store line', '(209) 478-5718', 'loc-467@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #184', '184', '', 'Shannon', 'Buyer', '(442) 268-0105', 'loc-1152@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Wants to order, not sure of Guardian schedule, never gets orders.  Connected her with Sonia to get clarity on order schedule. | Last contact: 2025-05-29'),
  ('BevMo', 'BEVMO! #107', '107', '', 'Store', 'Store line', '(760) 342-3277', 'loc-456@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #144', '144', '', 'Store', 'Store line', '(805) 968-0650', 'loc-518@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #76', '76', '', 'Store', 'Store line', '(661) 272-1834', 'loc-439@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #151', '151', '', 'Store', 'Store line', '(805) 347-9120', 'loc-470@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #55', '55', '', 'Chris', 'Buyer', '(510) 745-8556', 'loc-458@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Says they havent really been ordering, send him the list Monday. Thought we were through Golden Brands. | Order day: Monday | Deliver day: Wednesday | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #26', '26', '', 'Oscar', 'Buyer', '(925) 254-3161', 'loc-490@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Send weekly inventory, orders Saturday for Sunday cutoff- include SKUS. Walks the stores with printouts. Says if we send distributor Illa and Peachy stock this week he will "absolutely" take it. | Order day: Saturday (Sunday cutoff) | Illa commitment: Yes | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #180', '180', '', 'Josh', 'Buyer', '(925) 282-8185', 'loc-1448@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Familiar with the brand. Orders mango tall cans. Having inventory issues on their end, showing incorrect numbers in Bevmo system - currently working to get it fixed. When they do order often get rejected due to not meeting minimums or exceeding budgets. Does well with six packs and singles. Will be on the lookout for Illa Vanilla availability. Orders Saturday-Sunday (can send emails Friday). | Order day: Saturday/Sunday'),
  ('BevMo', 'BEVMO! #61', '61', '', 'Donna', 'Buyer', '(510) 669-1331', 'loc-1463@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | No Ciders. About to do inventory.  She will take a look at what we have. | Order day: Send Monday | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #70', '70', '', 'Kevin', 'Buyer', '(925) 979-9170', 'loc-514@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Does well with all pack sizes, has placed multiple orders but everything gets zeroed out. Will be on the look out for an active inventory list. | Order day: Send Monday | Deliver day: Wednesday | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #116', '116', '', 'Robin', 'Buyer', '(510) 923-0461', 'loc-485@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Orders twice, fills holes. Store manager wants zero holes on shelves. Gave her SKUS to order Hazy and Big Daddy on Sunday. Would order Cider if available, also asked for ales, lagers, sours, seltzers.  Checks email daily but needs SKUS to find the item.  Let her know when more items are available. | Order day: Sunday | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #5', '5', '', 'Victor', 'Buyer', '(510) 208-5126', 'loc-403@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Forgot who we were until he pulled up past purchase orders, then got excited. Stopped ordering because orders werent being delivered. Thanked me for calling and reminding me- "This is the perfect time, summer is right around the corner." | Order day: Tuesday | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #1', '1', '', 'Whitney', 'Buyer', '(925) 472-0130', 'loc-406@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Has not been ordering our brands, used to order capt Hazy at another store. Will place an order if we start sending inventory reports. Orders Monday for Friday delivery. Reset coming next week. Does well with all pack sizes, 19oz sells well when in the fridge, will see what space is available after reset. | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #134', '134', '', 'AJ', 'Buyer', '(925) 837-2329', 'loc-488@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Unlikely to order anytime soon- reset coming up in 2-3 weeks. just got to store, came from Danville. tossed Mystic not too long ago *last bought 1/24* Capt Hazy in disco bin. Not happy with markstein, merchandisers not good, dates on items not good, deliveries every two weeks even they arent far from warehouse. Reach back out after reset, see what we can do to appease situation. | Best days: Wed after 3 | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #14', '14', '', 'Store', 'Store line', '(925) 416-2083', 'loc-482@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | No Answer'),
  ('BevMo', 'BEVMO! #158', '158', '', 'Lupe', 'Buyer', '(510) 460-1965', 'loc-497@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Places orders for Sonoma cider regularly, Just placed an order  last week. Can never get it.  If we stock it she we always stock it. Orders Friday, send active inventory list and she will order more. Can never get anything. | Illa commitment: Yes | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #27', '27', '', 'Store', 'Store line', '(925) 820-5050', 'loc-487@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #4', '4', '', 'Jonathan', 'Buyer', '(510) 525-9582', 'loc-449@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Best days: Thursday/Friday | Last contact: 2025-07-17'),
  ('BevMo', 'BEVMO! #42', '42', '', 'Josh', 'Buyer', '(925) 754-8600', 'loc-482@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Best days: Wednesday 11AM'),
  ('BevMo', 'BEVMO! #89', '89', '', 'Store', 'Store line', '(925) 373-0425', 'loc-1445@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Call Back Thursday (Did not give name, operationally extremely busy today) | Best days: Off Wednesday'),
  ('BevMo', 'BEVMO! #119', '119', '', 'Tyler', 'Buyer', '(650) 340-6197', 'loc-512@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | 6/19 Spoke with Tyler, awknowdeged I know about his store size constraints- we have been working to get our 19oz cans approved to fill Bevmo 19oz gaps. Says he has lots of room for that size and will place an order. | Didnt really want to have conversation about new bringing in anything new, No room for new beer. Very small space. Told him about Peachy Vibes and Illa Vanilla. | Order day: Didnt say | Illa commitment: No'),
  ('BevMo', 'BEVMO! #105', '105', '', 'Leti', 'Buyer', '(408) 224-0143', 'loc-459@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Name to confirm (sheet had "Leti?"). | Rushed conv. lots of vendors in store. First said no issued ordering FC, then said last time she orderd did not recieve any of it. Says to email her availability on Fridays. Wants the Ice Cream beer. | Order day: Friday | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #20', '20', '', 'Jonathan', 'Buyer', '(650) 757-0196', 'loc-405@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Reset Coming Soon, order light next few months. Says he already orders everything. Will be placing an order today and will look at Peachy Vibes. | Order day: Friday | Illa commitment: No'),
  ('BevMo', 'BEVMO! #49', '49', '', 'Jason', 'ASM', '(408) 847-8266', 'loc-778@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Jason runs beer department, Shah store manager does ordering- off next week. Jason will look what is available and place an order- peachy vibes for sure. | Order day: Monday'),
  ('BevMo', 'BEVMO! #49', '49', '', 'Shah', 'GM', '(408) 847-8266', '', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #124', '124', '', 'Michael', 'Buyer', '(650) 462-9107', 'loc-521@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | 6/19  Not working, call back Friday 8AM - POs show they are ordering Big Daddy 16oz. Need to get them ordering 12oz and 19oz. | Rarely meets minimums, Put SKUS in the emails - makes it easier to order. Going to take a look- Ryan send email with available inventory for order. 18 Items listed under FC? | Order day: Monday Morning | Best days: OFF THURSDAY | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #133', '133', '', 'Shin', 'ASM', '(408) 725-2463', 'loc-464@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | 6/13 Matt (GM) printed out SKU to let Shin know it is available to add to next order, plenty of room for 19oz at the moment so shouldnt be a problem but up to Shin (ASM) | Already placed an illa order, will talk to Alex about bringing in the rest of the lineup. | Order day: Monday Morning | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #133', '133', '', 'Alex', 'GM (ordering)', '(408) 725-2463', '', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #21', '21', '', 'Wanda', 'Buyer', '(650) 577-8161', 'loc-496@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | 6/19 Spoke with Cassandra about size of the set- that we''ve been working to get beer approved that works with the constraints of the GoPuff system/store sizes. She says they should have room for 19oz but are on a new trial ordering system so might not be able to order this week. Will talk to Wanda (ASM/buyer) and most likely add it to PO next week. | Sounded defeated, went through a reset. Down to one row of beer. Would like to bring it in but does not have room, maybe call back in a month? Receiever keeps ordering beer,Literally beer everwhere. They dont even answer emails right now. | Order day: Monday Morning'),
  ('BevMo', 'BEVMO! #66', '66', '', 'Delilah', 'Buyer', '(408) 298-1193', 'loc-506@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Commit- Mango, Cpt Hazy, Pie, Peachy.  Took a screen shot of everything and said she''d add it all to her monday morning order. | Order day: Monday Morning | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #67', '67', '', 'Melissa', 'Buyer', '(650) 965-4721', 'loc-436@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Pulled up available SKUS and said she will place an order next week. | Order day: Monday Morning | Deliver day: Thursday | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #34', '34', '', 'Chris', 'Buyer', '(650) 261-1414', 'loc-1441@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Call back 30 minutes ( Noonish ) | Didnt know we also have Speakeasy, Sonoma. Printed out and highlited availbility. | Order day: Saturday/Sunday | Deliver day: Friday | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #187', '187', '', 'Emily', 'Buyer', '(408) 946-8112', 'loc-400@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | 6/19 Said she will take a look at the new items list and add it to the list if there is room in the cooler. | Wrote down in notes that Mango, Big Daddy and Peachy are available, has been tryin to order peachy. | Order day: Sunday | Best days: Changes | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #191', '191', '', 'Erica', 'Buyer', '(669) 842-6583', 'loc-1476@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Places orders, never gets delivered. Will place an order on Sunday - Peachy, Hazy, Mango, Pie - Has been trying to order Illa. | Order day: Sunday | Best days: OFF THURSDAY | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #9', '9', '', 'Adriana', 'Buyer', '(650) 949-1826', 'loc-1019@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Name to reconfirm (per sheet). | Wanted SKU numbers on anything I was talking about, make sure to attach SKU numbers when sending over emails to her. | Order day: Sunday Monring | Illa commitment: No'),
  ('BevMo', 'BEVMO! #28', '28', '', 'Store', 'Store line', '(415) 933-8494', 'loc-504@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Called and let Matt know 19 oz in stock, hes going to look at cold box to see if they have room. All 19 oz go in cold box.'),
  ('BevMo', 'BEVMO! #3', '3', '', 'Store', 'Store line', '(415) 648-1233', 'loc-399@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #41', '41', '', 'Store', 'Store line', '(408) 946-8112', 'loc-781@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #7', '7', '', 'Aja', 'Buyer', '(408) 248-2776', 'loc-407@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | 6/19 Said she will add Big Daddy 19 to next order, did not order last week based on budget. Asked if we can get them Full Circle 19oz cans, specifically 19oz Peachy Vibes. Customers dont want to commit to a six pack- most of the stores in the bay area have extra 19oz space and trouble filling it now.'),
  ('BevMo', 'BEVMO! #71', '71', '', 'Store', 'Store line', '(415) 447-8483', 'loc-434@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #77', '77', '', 'Richard', 'Buyer', '(650) 583-1099', 'loc-1446@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | 6/19  Let them know big daddy 19oz cans available, they will take a look.'),
  ('BevMo', 'BEVMO! #177', '177', '', 'Store', 'Store line', '(559) 472-7871', 'loc-417@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #143', '143', '', 'Store', 'Store line', '(559) 625-5285', 'loc-419@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #35', '35', '', 'Store', 'Store line', '(559) 431-2626', 'loc-470@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #81', '81', '', 'Store', 'Store line', '(209) 634-1738', 'loc-425@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | talk to megan asm 1pm'),
  ('BevMo', 'BEVMO! #183', '183', '', 'Store', 'Store line', '(657) 221-3340', 'loc-420@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Line goes to voice mail'),
  ('BevMo', 'BEVMO! #88', '88', '', 'Kaylee', 'Buyer', '(818) 847-2175', 'loc-498@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Kaylee beer buyer- familiar with the brand, just did reset pretty stocked up on IPAs but looking for blondes, wheats, anything else. Already has Peachy on shelf. Orders Saturday- Monday 12pm cutoff time. Orders quite a bit from Guardian. | Order day: Saturday'),
  ('BevMo', 'BEVMO! #135', '135', '', 'Elaine', 'Buyer', '(805) 437-1772', 'loc-1442@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Thought Guardian went out of business, forgot why they stopped ordering from them- had to remember deliveries come every 2 weeks and $300 minimum which is hard to meet, and items were often out of stock. Agreed to give us a chance if Guardian has inventory, she will take a look at Guardian inventory today- told her I have live access. Sent it over with sales sheets while on the phone. My job is to make ordering as easy as possible and communicate new items to Bevmo in real time, make sure relationship doesnt drop off. She appreciates the call and will look to build an order. | Order day: Sunday'),
  ('BevMo', 'BEVMO! #40', '40', '', 'Store', 'Store line', '(818) 340-1548', 'loc-142@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #190', '190', '', 'Store', 'Store line', '(909) 627-4999', 'loc-409@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Called said they were to busy | Contact: 5/14/25 - Ed'),
  ('BevMo', 'BEVMO! #161', '161', '', 'Store', 'Store line', '(909) 859-2067', 'loc-499@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #79', '79', '', 'Vanessa', 'Buyer', '(951) 549-8437', 'loc-473@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Sheet listed "Vanessa, Anissa?" - name to confirm. | Orders every sunday - send Sunday morning. Familiar with Captain Save a Hop. Good to hear we will be sending out sales sheets/ availability directly. they read everything right before ordering. Dont send Friday, send Sunday. Vanessa and Anissa alternate weekends, Amber sometimes orders too. | Order day: Sunday Morning'),
  ('BevMo', 'BEVMO! #79', '79', '', 'Amber', 'Store Manager', '(951) 549-8437', '', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #161', '161', '', 'Andrew', 'Buyer', '(310) 773-5618', 'loc-423@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Call back 5/30 | Last contact: 2025-05-29'),
  ('BevMo', 'BEVMO! #68', '68', '', 'Sam', 'Buyer', '(714) 891-1242', 'loc-453@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Orders Sunday - busy ringing people up, appreciated the call, listened but didnt have time to talk.'),
  ('BevMo', 'BEVMO! #179', '179', '', 'Caleb', 'Buyer', '(949) 234-7451', 'loc-1444@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Well familiar with Full Circle, brand does well. Used to have issues with out of stocks but lately the issues have gotten better. Good to know we are bulking up inventory and SKUS at Guardian. Will look to see what is available to order, especially the Illa, do not currently have any Milkshake IPAs and they might need more Peachy as well. Always send new sales sheets when we drop off at distro. | Order day: Send Friday'),
  ('BevMo', 'BEVMO! #129', '129', '', 'Mar', 'Buyer', '(818) 342-1590', 'loc-491@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Left message for call back with Andrea - Buyer - Mar'),
  ('BevMo', 'BEVMO! #127', '127', '', 'Store', 'Store line', '(818) 291-4009', 'loc-495@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Said beer buyer isn''t in till 5pm and to call back | Contact: 5/14/25 - Ed'),
  ('BevMo', 'BEVMO! #75', '75', '', 'Bailey', 'Buyer', '(909) 592-1583', 'loc-455@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Well familiar with Full Circle, able to name multiple beers right away. Has not had any problems getting orders,multiple orders so far this year. Well familiar with the brand. Asks that I send new item items/inventory Monday/Tuesday. Will continue to bring in new items if they are available. | Order day: Monday'),
  ('BevMo', 'BEVMO! #37', '37', '', 'Skyler', 'Buyer', '(714) 842-5117', 'loc-442@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Call back friday morning'),
  ('BevMo', 'BEVMO! #29', '29', '', 'Carlos', 'Buyer', '(949) 551-3377', 'loc-440@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Guardian has no order in the system. Dust bowl other big brand, will look to put together an order - Peachy Viibes and Illa.  FC not on radar, Guardian not on radar. Told Carlos to reach out directly if he needs anything. Send emails when new items come out, Guardian gets deliveries. | Order day: Monday | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #54', '54', '', 'Store', 'Store line', '(949) 643-3020', 'loc-516@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | sell illa'),
  ('BevMo', 'BEVMO! #84', '84', '', 'Daniel', 'Buyer', '(949) 462-2101', 'loc-474@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Call back 1 PM Daniel'),
  ('BevMo', 'BEVMO! #182', '182', '', 'Michelle', 'Manager', '(562) 297-0286', 'loc-505@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Already orders, send sheets will look - was hurried to get off phone. | Last contact: 2025-05-28'),
  ('BevMo', 'BEVMO! #80', '80', '', 'Crystal', 'Buyer', '(562) 598-1850', 'loc-503@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Thursday - Sunday'),
  ('BevMo', 'BEVMO! #121', '121', '', 'Store', 'Store line', '(323) 882-6971', 'loc-508@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #122', '122', '', 'Blair', 'Buyer', '(818) 754-1758', 'loc-500@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Call back after 1030'),
  ('BevMo', 'BEVMO! #156', '156', '', 'Kaitlin', 'Buyer', '(661) 347-2927', 'loc-515@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Kaitlin familiar with the brand, orders the brand when in stock - knows Eric. Let her know we just dropped off Peachy Vibes 12oz/19oz and IllaVanilla, more SKUS coming next week including Mango Bomb which they have been trying to get. Orders Sunday sometimes Monday if needed. | Order day: Sunday'),
  ('BevMo', 'BEVMO! #113', '113', '', 'Edwin', 'Buyer (main contact)', '(310) 257-0034', 'loc-415@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Dustin helps with orders, Edwin does main buying. Hasnt seen FC in store in a while, believes they used to carry it - Familiar with the brand. Will check out available inventory when I send it over, good to know whats coming and to know distro will be able to support and deliver on orders. | Order day: Tuesday'),
  ('BevMo', 'BEVMO! #113', '113', '', 'Dustin', 'Manager', '(310) 257-0034', '', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #136', '136', '', 'Eric', 'Buyer', '(310) 855-0169', 'loc-786@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | light staffed call at 1130 | Last contact: 2025-05-29'),
  ('BevMo', 'BEVMO! #186', '186', '', 'Cathy', 'Buyer', '(323) 879-6242', 'loc-502@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Multiple buyers, used to be main buyers. Whoever opens corporate mandate email does the buying. Mainly orders what corp. mandates. Has not heard of Full Circle. Sometimes orders from Guardian when they pop up on the mandate list. Orders Sunday, Monday cutoff. | Order day: Sunday'),
  ('BevMo', 'BEVMO! #111', '111', '', 'Store', 'Store line', '(310) 727-9501', 'loc-429@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | no answer call back'),
  ('BevMo', 'BEVMO! #174', '174', '', 'Andrew', 'Buyer', '(310) 773-5630', 'loc-507@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Hasnt ordered from us, orders Guardian often, last few times has not made them meet minimum. Orders Sunday and Wednesday. Will look at availability and has no problem bringing in FC items. | Order day: Sunday/Wednesday'),
  ('BevMo', 'BEVMO! #159', '159', '', 'Store', 'Store line', '(951) 867-4978', 'loc-444@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | no answer call back'),
  ('BevMo', 'BEVMO! #31', '31', '', 'Store', 'Store line', '(714) 279-8131', 'loc-408@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Vanessa filling in, regular buyer just quit. Ginger/John normal managers. Buys Sundays sometimes Tuesdays. Beers sound good, especially Peachy right down street at Disneyland. Send availability and she will use it to show other managers how to put in an order later today. | Order day: Sunday'),
  ('BevMo', 'BEVMO! #109', '109', '', 'Chris', 'Buyer', '(949) 347-9850', 'loc-489@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Hasnt tried to order in a long time, nobody asks for it. Hasnt been able to get it.Talked about fully stocking Guardian and keeping them stocked with MORE items. By the 12th - fully stocked.  Send SKU list, hell see whats available and give us a chance with customers. Send weekly availabilty to make sure they dont order out of stock items. | Order day: Monday'),
  ('BevMo', 'BEVMO! #132', '132', '', 'Store', 'Store line', '(626) 744-0520', 'loc-454@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #51', '51', '', 'Garret', 'Buyer', '(626) 356-9462', 'loc-416@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Orders Sunday, familiar with the brand. Carries Peachy in both sizes but interested in bringing in Illa Vanilla. Send him the sales sheet and he will check it out when he does the next order. | Order day: Sunday'),
  ('BevMo', 'BEVMO! #52', '52', '', 'Jason Fisher', 'Manager', '(909) 646-8333', 'loc-468@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Familiar with Full Circle, doesnt do the ordering himself but can tell Serena to order new items that look good. Send sales sheets directly to Jason.Fisher2@gopuff.com. Good to know the distri. will be fully stocked up, he will take a look at inventory availability and see about putting in an order this weekend. | Order day: Sunday'),
  ('BevMo', 'BEVMO! #52', '52', '', 'Serena', 'Buyer', '(909) 646-8333', '', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #173', '173', '', 'Store', 'Store line', '(949) 216-3506', 'loc-1439@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Line Always Busy'),
  ('BevMo', 'BEVMO! #48', '48', '', 'Hector', 'Store Manager', '(909) 748-0349', 'loc-472@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Collect all emails throughout the week and put in a binder for Sunday ordering. Make sure to attach SKUS to items. Sounded excited about Illa. | Order day: Orders Sunday - Send email Monday'),
  ('BevMo', 'BEVMO! #114', '114', '', 'Shaun', 'Buyer', '(951) 304-9670', 'loc-517@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Shaun Suggested staff training, says beer moves slow, distro sends sheets on Mon. shaunducross@gopuff.com | Order day: Monday | Contact: 5/14/25 - Ed'),
  ('BevMo', 'BEVMO! #168', '168', '', 'Mark', 'Buyer', '(951) 565-4170', 'loc-1440@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Call Later'),
  ('BevMo', 'BEVMO! #125', '125', '', 'Store', 'Store line', '(805) 687-4000', 'loc-510@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Called they said buyer (hector) was busy and too call back. Does inventory''s on wed. Bad day to call. | Contact: 5/14/25 - ed'),
  ('BevMo', 'BEVMO! #123', '123', '', 'Store', 'Store line', '(310) 453-5600', 'loc-427@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Picked up but put me on hold for 10 min. Hung up | Contact: 5/14/25 - Ed'),
  ('BevMo', 'BEVMO! #57', '57', '', 'Steve', 'Buyer', '(805) 578-9780', 'loc-465@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Full on IPAs, Peachy sounds good. Will take a look this weekend and see if they have room for anything. Told him about ILLA VANILLA, been with Bevmo 18 years, very familiar with the brand hasnt ordered lately.'),
  ('BevMo', 'BEVMO! #39', '39', '', 'Rolando', 'Buyer', '(805) 230-2883', 'loc-1117@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Definitely heard of the brand, carries it when available. Good to know distributor will have new items. Looking to expand beer set. Orders Monday - Tuesday 12pm cutoff time. | Order day: Monday'),
  ('BevMo', 'BEVMO! #167', '167', '', 'Ben', 'Buyer', '(424) 275-6611', 'loc-1447@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | call at 1050'),
  ('BevMo', 'BEVMO! #56', '56', '', 'Eric', 'Buyer', '(310) 543-9170', 'loc-462@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Eric just came from Redondo beach store, Encino before that, familiar with brand. Store hasnt been ordering our beer. He used to order Hazy at other stores. Good conv. about out of stocks and importance of keeping distro stocked to keep stores stocked. Agreed to bring in cases on the 12th - commitment to let Distro know. Orders Monday/Tuesday. Will order to meet minimum. | Order day: Monday/Tuesday | Illa commitment: Yes'),
  ('BevMo', 'BEVMO! #165', '165', '', 'Store', 'Store line', '(909) 532-8773', 'loc-783@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Put on hold 5 minutes'),
  ('BevMo', 'BEVMO! #163', '163', '', 'Angel', 'Buyer', '(951) 867-4978', 'loc-422@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Call back 5/30 | Last contact: 2025-05-29'),
  ('BevMo', 'BEVMO! #44', '44', '', 'Store', 'Store line', '(661) 753-9075', 'loc-781@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #38', '38', '', 'Jackson', 'Buyer', '(818) 989-3940', 'loc-438@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Call back later today | Last contact: 2025-05-29'),
  ('BevMo', 'BEVMO! #131', '131', '', 'Justin', 'Store Manager', '(805) 642-7317', 'loc-460@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Took a second to remember Full Circle, wound up adding to already open Guardian order - case of each Peachy and Illa Vanilla. No problem meeting Guardian minimums.'),
  ('BevMo', 'BEVMO! #172', '172', '', 'Frank', 'Buyer', '(626) 722-5241', 'loc-414@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Orders every day of the week, did not know we had Peachy or Illa in stock. Thought they had A lot of SKUS on the shelf, had less that he thought. Will look to put in a "sizable order" tomorrow. Sending him updated inventory right now. | Last contact: 2025-05-29'),
  ('BevMo', 'BEVMO! #43', '43', '', 'Store', 'Store line', '(323) 882-6971', 'loc-457@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | sell illa'),
  ('BevMo', 'BEVMO! #181', '181', '', 'Vivian', 'Buyer', '(562) 553-5230', 'loc-426@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Asked if everything was in stock, will take a look at putting in an order. Was interested in all pack sizes. | Order day: Sundays and Thursdays | Last contact: 2025-05-29'),
  ('BevMo', 'BEVMO! #58', '58', '', 'Store', 'Store line', '(949) 548-4919', 'loc-441@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #63', '63', '', 'Store', 'Store line', '(951) 506-2595', 'loc-780@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #78', '78', '', 'Store', 'Store line', '(951) 278-4512', 'loc-1118@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #11', '11', '', 'Store', 'Store line', '(760) 943-6631', 'loc-483@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #110', '110', '', 'Store', 'Store line', '(760) 489-7019', 'loc-463@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #12', '12', '', 'Store', 'Store line', '(858) 673-3892', 'loc-447@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #126', '126', '', 'Store', 'Store line', '(619) 221-8062', 'loc-446@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Ryan, out until tuesday | Last contact: 2025-06-06'),
  ('BevMo', 'BEVMO! #13', '13', '', 'Store', 'Store line', '(619) 461-6230', 'loc-404@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Has been trying to order Peachy 6packs since January. Insight on San Diego Market, La Mesa, Pt Loma, and Chula Vista big 3 for craft. Weekly deliveries. Most of the other stores are smaller. This store one of the biggest BevMos in network. Has most other items on shelf, except Peachy 6packs. let him know when it comes in. | Last contact: 2025-06-06'),
  ('BevMo', 'BEVMO! #137', '137', '', 'Store', 'Store line', '(619) 397-4524', 'loc-509@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #145', '145', '', 'Store', 'Store line', '(619) 448-2453', 'loc-418@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #155', '155', '', 'Store', 'Store line', '(619) 326-9987', 'loc-1456@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #171', '171', '', 'Store', 'Store line', '(760) 298-5626', 'loc-10174@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #185', '185', '', 'Store', 'Store line', '(619) 456-0914', 'loc-1443@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #188', '188', '', 'Store', 'Store line', '(442) 232-2094', 'loc-1452@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #189', '189', '', 'Store', 'Store line', '(858) 320-0459', 'loc-401@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #36', '36', '', 'Store', 'Store line', '(619) 295-3171', 'loc-501@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #50', '50', '', 'Store', 'Store line', '(858) 729-0775', 'loc-1016@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('BevMo', 'BEVMO! #59', '59', '', 'Store', 'Store line', '(760) 967-8606', 'loc-413@gopuff.com', 'From Chain Store Call Sheet (2025 calls). | Jamie, out to lunch | Last contact: 2025-06-06'),
  ('BevMo', 'BEVMO! #74', '74', '', 'Store', 'Store line', '(858) 792-7036', 'loc-1454@gopuff.com', 'From Chain Store Call Sheet (2025 calls).'),
  ('Grocery Outlet', 'GROCERY OUTLET #451', '451', '4437850', 'James', 'Buyer', '(415) 276-2797', 'sanfranciscobayshore@groceryoutlet.com', 'From Chain Store Call Sheet (2025 calls). | Cutting down on craft section, told him about Speakeasy- 6 packs, said its right in his price range- send him sales sheets and he''ll talk to Matagrano rep, | Last contact: 2025-06-02'),
  ('Grocery Outlet', 'GROCERY OUTLET #297', '297', '3922580', 'Darrel', 'Buyer', '(925) 524-0004', 'claytonvalley@groceryoutlet.com', 'From Chain Store Call Sheet (2025 calls). | Went in during blitz | Contact: Emailed sales sheet 5.29.25'),
  ('Grocery Outlet', 'GROCERY OUTLET #242', '242', '3568529', 'Jose', 'Buyer', '(510) 619-2640', '', 'From Chain Store Call Sheet (2025 calls). | Remembers they used to buy Speakeasy. Asked what was available at the distributor, about pack size, said to have the Markstein rep come in and tell him what he could get from both brands. They do well with everything so he is open to trying what the rep recommends. | Last contact: 2025-06-02'),
  ('Grocery Outlet', 'GROCERY OUTLET #269', '269', '3763883', 'David', 'Buyer', '(925) 684-7439', 'david530@live.com', 'From Chain Store Call Sheet (2025 calls). | Hasnt thought to look if our items were active in a while, familiar with the brand. Knew we were out of stock for a while. Punched in the items we talked about, will look into putting in an order tomorrow. Gave me his email to let him know when new items are sent to Markstein. | Last contact: 2025-06-03'),
  ('Grocery Outlet', 'GROCERY OUTLET #3', '3', '534799', 'Store', 'Store line', '(510) 465-5649', '', 'From Chain Store Call Sheet (2025 calls). | STEVE BRUCE | Last contact: 2025-06-02'),
  ('Grocery Outlet', 'GROCERY OUTLET #280', '280', '3948153', 'Store', 'Store line', '(510) 239-4439', '', 'From Chain Store Call Sheet (2025 calls). | STEVE BRUCE | Last contact: 2025-05-30'),
  ('Grocery Outlet', 'GROCERY OUTLET #11', '11', '2143387', 'Yulia', 'Buyer', '(925) 676-3660', '', 'From Chain Store Call Sheet (2025 calls). | Eric owner, YUlia is buyer. Cutting down SKUS by 21. Not very happy, why am I calling and not coming in? "Phone calls are not good for a business relationship." WIne event coming up. Wine takes priority at this store. Didnt want to hear what I had to say, wanted to lecture on Wine and business ethics of phone calls vs in person visits. Said Yulia works this Friday-Sunday if I want to come talk to her, but they dont have room for more beer. Hung up as I was asking for email. | Last contact: 2025-06-03'),
  ('Grocery Outlet', 'GROCERY OUTLET #181', '181', '3235288', 'Alex', 'Buyer', '(925) 363-3421', 'concord@groceryoutlet.com', 'From Chain Store Call Sheet (2025 calls). | Stopped in - said to send emails | Contact: Stopped in 5/20/25'),
  ('Grocery Outlet', 'GROCERY OUTLET #35', '35', '2014628', 'Store', 'Store line', '(925) 961-0019', '', 'From Chain Store Call Sheet (2025 calls). | Mailbox full, number straight to voicemail | Last contact: 2025-06-05'),
  ('Grocery Outlet', 'GROCERY OUTLET #268', '268', '3931599', 'Store', 'Store line', '(925) 776-5722', '', 'From Chain Store Call Sheet (2025 calls). | took a message, wouldnt tell me a managers name. | Last contact: 2025-06-03'),
  ('Grocery Outlet', 'GROCERY OUTLET #382', '382', '4152717', 'Store', 'Store line', '(510) 400-9524', '', 'From Chain Store Call Sheet (2025 calls). | Call Jerry Owner Wed 10AM | Last contact: 2025-06-03'),
  ('Grocery Outlet', 'GROCERY OUTLET #440', '440', '4464288', 'Greg', 'Buyer', '(925) 390-3990', 'brentwood@groceryoutlet.com', 'From Chain Store Call Sheet (2025 calls). | Bringing in items currently. | Contact: Called 6/2/25'),
  ('Grocery Outlet', 'GROCERY OUTLET #31', '31', '3244544', 'Sam', 'Buyer', '(510) 223-3404', '', 'From Chain Store Call Sheet (2025 calls). | Didnt want to talk, kept asking me why I was calling. I explained I wanted to sell beer, asked for the best days to catch him- Tuesday and Wednesday Next Week. He did give me his email when asked. When I asked if he had seen our brand before he said no, then said he didnt have time for this and hung up.'),
  ('Grocery Outlet', 'GROCERY OUTLET #138', '138', '3103982', 'Alicia', 'Buyer', '(510) 895-3605', '', 'From Chain Store Call Sheet (2025 calls). | after 3pm | Last contact: 2025-06-05'),
  ('Grocery Outlet', 'GROCERY OUTLET #133', '133', '2143386', 'Luis', 'Buyer', '(510) 791-5124', '', 'From Chain Store Call Sheet (2025 calls). | on lunch | Last contact: 2025-06-05'),
  ('Grocery Outlet', 'GROCERY OUTLET #52', '52', '2212308', 'Justin', 'Buyer', '(510) 723-3336', '', 'From Chain Store Call Sheet (2025 calls). | Heard of Speakeasy, Not FC, Usually arround M/T.  Send sales sheets and come by drop samples he''ll check it out. | Last contact: 2025-06-03'),
  ('Grocery Outlet', 'GROCERY OUTLET #82', '82', '3035103', 'Alma', 'Buyer', '(510) 881-8020', '', 'From Chain Store Call Sheet (2025 calls). | Out to lunch | Last contact: 2025-06-03'),
  ('Grocery Outlet', 'GROCERY OUTLET #33', '33', '3236989', 'Freshna', 'Buyer', '(510) 651-2005', '', 'From Chain Store Call Sheet (2025 calls). | Name to confirm (sheet had "Freshna?"). | Didnt want to give email, said they werent buying right now. Said we have to go through corporate - when I explained we''re already approved and just want to send sales sheets and know the best days to come in and connect with the buyer she said they are doing inventory over the next couple weeks, try again after. Wouldnt give a specific end date. | Last contact: 2025-06-03'),
  ('Grocery Outlet', 'GROCERY OUTLET #182', '182', '3231080', 'Sukhi', 'Buyer', '(925) 557-1361', 'dublin@groceryoutlet.com', 'From Chain Store Call Sheet (2025 calls). | Has not heard of the brands, Sukhi and his sister are co-owners. There pretty much every day. Stop in and drop off samples. Looks live we''ve never sold into this store. | Last contact: 2025-06-03'),
  ('Total Wine', 'TOTAL WINE & MORE #1121', '1121', '4052116', 'Brandon', 'Buyer', '(925) 463-0233', '', 'From Chain Store Call Sheet (2025 calls). | Off Wed. Call Thursday | Last contact: 2025-06-04');

insert into _ccs_phones values
  ('BevMo', 'BEVMO! #118', '118', '', '8314751139'),
  ('BevMo', 'BEVMO! #148', '148', '', '2093671024'),
  ('BevMo', 'BEVMO! #46', '46', '', '2095453320'),
  ('BevMo', 'BEVMO! #162', '162', '', '2093156428'),
  ('BevMo', 'BEVMO! #150', '150', '', '2098363732'),
  ('BevMo', 'BEVMO! #60', '60', '', '2094785718'),
  ('BevMo', 'BEVMO! #184', '184', '', '4422680105'),
  ('BevMo', 'BEVMO! #107', '107', '', '7603423277'),
  ('BevMo', 'BEVMO! #103', '103', '', '8314422411'),
  ('BevMo', 'BEVMO! #144', '144', '', '8059680650'),
  ('BevMo', 'BEVMO! #76', '76', '', '6612721834'),
  ('BevMo', 'BEVMO! #151', '151', '', '8053479120'),
  ('BevMo', 'BEVMO! #55', '55', '', '5107458556'),
  ('BevMo', 'BEVMO! #26', '26', '', '9252543161'),
  ('BevMo', 'BEVMO! #180', '180', '', '9252828185'),
  ('BevMo', 'BEVMO! #61', '61', '', '5106691331'),
  ('BevMo', 'BEVMO! #70', '70', '', '9259799170'),
  ('BevMo', 'BEVMO! #116', '116', '', '5109230461'),
  ('BevMo', 'BEVMO! #5', '5', '', '5102085126'),
  ('BevMo', 'BEVMO! #1', '1', '', '9254720130'),
  ('BevMo', 'BEVMO! #134', '134', '', '9258372329'),
  ('BevMo', 'BEVMO! #14', '14', '', '9254162083'),
  ('BevMo', 'BEVMO! #158', '158', '', '5104601965'),
  ('BevMo', 'BEVMO! #27', '27', '', '9258205050'),
  ('BevMo', 'BEVMO! #4', '4', '', '5105259582'),
  ('BevMo', 'BEVMO! #42', '42', '', '9257548600'),
  ('BevMo', 'BEVMO! #89', '89', '', '9253730425'),
  ('BevMo', 'BEVMO! #119', '119', '', '6503406197'),
  ('BevMo', 'BEVMO! #105', '105', '', '4082240143'),
  ('BevMo', 'BEVMO! #20', '20', '', '6507570196'),
  ('BevMo', 'BEVMO! #49', '49', '', '4088478266'),
  ('BevMo', 'BEVMO! #124', '124', '', '6504629107'),
  ('BevMo', 'BEVMO! #133', '133', '', '4087252463'),
  ('BevMo', 'BEVMO! #21', '21', '', '6505778161'),
  ('BevMo', 'BEVMO! #66', '66', '', '4082981193'),
  ('BevMo', 'BEVMO! #67', '67', '', '6509654721'),
  ('BevMo', 'BEVMO! #34', '34', '', '6502611414'),
  ('BevMo', 'BEVMO! #187', '187', '', '4089468112'),
  ('BevMo', 'BEVMO! #191', '191', '', '6698426583'),
  ('BevMo', 'BEVMO! #9', '9', '', '6509491826'),
  ('BevMo', 'BEVMO! #28', '28', '', '4159338494'),
  ('BevMo', 'BEVMO! #3', '3', '', '4156481233'),
  ('BevMo', 'BEVMO! #41', '41', '', '4089468112'),
  ('BevMo', 'BEVMO! #7', '7', '', '4082482776'),
  ('BevMo', 'BEVMO! #71', '71', '', '4154478483'),
  ('BevMo', 'BEVMO! #77', '77', '', '6505831099'),
  ('BevMo', 'BEVMO! #177', '177', '', '5594727871'),
  ('BevMo', 'BEVMO! #143', '143', '', '5596255285'),
  ('BevMo', 'BEVMO! #35', '35', '', '5594312626'),
  ('BevMo', 'BEVMO! #81', '81', '', '2096341738'),
  ('BevMo', 'BEVMO! #183', '183', '', '6572213340'),
  ('BevMo', 'BEVMO! #88', '88', '', '8188472175'),
  ('BevMo', 'BEVMO! #135', '135', '', '8054371772'),
  ('BevMo', 'BEVMO! #40', '40', '', '8183401548'),
  ('BevMo', 'BEVMO! #190', '190', '', '9096274999'),
  ('BevMo', 'BEVMO! #161', '161', '', '9098592067'),
  ('BevMo', 'BEVMO! #79', '79', '', '9515498437'),
  ('BevMo', 'BEVMO! #68', '68', '', '7148911242'),
  ('BevMo', 'BEVMO! #179', '179', '', '9492347451'),
  ('BevMo', 'BEVMO! #129', '129', '', '8183421590'),
  ('BevMo', 'BEVMO! #127', '127', '', '8182914009'),
  ('BevMo', 'BEVMO! #75', '75', '', '9095921583'),
  ('BevMo', 'BEVMO! #37', '37', '', '7148425117'),
  ('BevMo', 'BEVMO! #29', '29', '', '9495513377'),
  ('BevMo', 'BEVMO! #54', '54', '', '9496433020'),
  ('BevMo', 'BEVMO! #84', '84', '', '9494622101'),
  ('BevMo', 'BEVMO! #182', '182', '', '5622970286'),
  ('BevMo', 'BEVMO! #80', '80', '', '5625981850'),
  ('BevMo', 'BEVMO! #121', '121', '', '3238826971'),
  ('BevMo', 'BEVMO! #122', '122', '', '8187541758'),
  ('BevMo', 'BEVMO! #156', '156', '', '6613472927'),
  ('BevMo', 'BEVMO! #113', '113', '', '3102570034'),
  ('BevMo', 'BEVMO! #136', '136', '', '3108550169'),
  ('BevMo', 'BEVMO! #186', '186', '', '3238796242'),
  ('BevMo', 'BEVMO! #111', '111', '', '3107279501'),
  ('BevMo', 'BEVMO! #174', '174', '', '3107735630'),
  ('BevMo', 'BEVMO! #159', '159', '', '9518674978'),
  ('BevMo', 'BEVMO! #31', '31', '', '7142798131'),
  ('BevMo', 'BEVMO! #109', '109', '', '9493479850'),
  ('BevMo', 'BEVMO! #132', '132', '', '6267440520'),
  ('BevMo', 'BEVMO! #51', '51', '', '6263569462'),
  ('BevMo', 'BEVMO! #52', '52', '', '9096468333'),
  ('BevMo', 'BEVMO! #173', '173', '', '9492163506'),
  ('BevMo', 'BEVMO! #48', '48', '', '9097480349'),
  ('BevMo', 'BEVMO! #114', '114', '', '9513049670'),
  ('BevMo', 'BEVMO! #168', '168', '', '9515654170'),
  ('BevMo', 'BEVMO! #125', '125', '', '8056874000'),
  ('BevMo', 'BEVMO! #123', '123', '', '3104535600'),
  ('BevMo', 'BEVMO! #57', '57', '', '8055789780'),
  ('BevMo', 'BEVMO! #39', '39', '', '8052302883'),
  ('BevMo', 'BEVMO! #167', '167', '', '4242756611'),
  ('BevMo', 'BEVMO! #56', '56', '', '3105439170'),
  ('BevMo', 'BEVMO! #165', '165', '', '9095328773'),
  ('BevMo', 'BEVMO! #163', '163', '', '9518674978'),
  ('BevMo', 'BEVMO! #44', '44', '', '6617539075'),
  ('BevMo', 'BEVMO! #38', '38', '', '8189893940'),
  ('BevMo', 'BEVMO! #131', '131', '', '8056427317'),
  ('BevMo', 'BEVMO! #172', '172', '', '6267225241'),
  ('BevMo', 'BEVMO! #43', '43', '', '3238826971'),
  ('BevMo', 'BEVMO! #181', '181', '', '5625535230'),
  ('BevMo', 'BEVMO! #58', '58', '', '9495484919'),
  ('BevMo', 'BEVMO! #63', '63', '', '9515062595'),
  ('BevMo', 'BEVMO! #78', '78', '', '9512784512'),
  ('BevMo', 'BEVMO! #11', '11', '', '7609436631'),
  ('BevMo', 'BEVMO! #110', '110', '', '7604897019'),
  ('BevMo', 'BEVMO! #12', '12', '', '8586733892'),
  ('BevMo', 'BEVMO! #126', '126', '', '6192218062'),
  ('BevMo', 'BEVMO! #13', '13', '', '6194616230'),
  ('BevMo', 'BEVMO! #137', '137', '', '6193974524'),
  ('BevMo', 'BEVMO! #145', '145', '', '6194482453'),
  ('BevMo', 'BEVMO! #155', '155', '', '6193269987'),
  ('BevMo', 'BEVMO! #171', '171', '', '7602985626'),
  ('BevMo', 'BEVMO! #185', '185', '', '6194560914'),
  ('BevMo', 'BEVMO! #188', '188', '', '4422322094'),
  ('BevMo', 'BEVMO! #189', '189', '', '8583200459'),
  ('BevMo', 'BEVMO! #36', '36', '', '6192953171'),
  ('BevMo', 'BEVMO! #50', '50', '', '8587290775'),
  ('BevMo', 'BEVMO! #59', '59', '', '7609678606'),
  ('BevMo', 'BEVMO! #74', '74', '', '8587927036'),
  ('Grocery Outlet', 'GROCERY OUTLET #305', '305', '3948175', '4158255678'),
  ('Grocery Outlet', 'GROCERY OUTLET #168', '168', '1343325', '4082922132'),
  ('Grocery Outlet', 'GROCERY OUTLET #306', '306', '3948176', '4158727170'),
  ('Grocery Outlet', 'GROCERY OUTLET #139', '139', '3418785', '6505501100'),
  ('Grocery Outlet', 'GROCERY OUTLET #4', '4', '2212311', '6503647406'),
  ('Grocery Outlet', 'GROCERY OUTLET #451', '451', '4437850', '4152762797'),
  ('Grocery Outlet', 'GROCERY OUTLET #238', '238', '3492168', '4082499046'),
  ('Grocery Outlet', 'GROCERY OUTLET #125', '125', '1343326', '4082412182'),
  ('Grocery Outlet', 'GROCERY OUTLET #410', '410', '4296938', '6692343465'),
  ('Grocery Outlet', 'GROCERY OUTLET #449', '449', '4424121', '4085407866'),
  ('Grocery Outlet', 'GROCERY OUTLET #231', '231', '3478855', '4084778350'),
  ('Grocery Outlet', 'GROCERY OUTLET #244', '244', '3644926', '4157151030'),
  ('Grocery Outlet', 'GROCERY OUTLET #320', '320', '3991208', '4089620297'),
  ('Grocery Outlet', 'GROCERY OUTLET #130', '130', '3399656', '4086845955'),
  ('Grocery Outlet', 'GROCERY OUTLET #196', '196', '3562663', '4085868205'),
  ('Grocery Outlet', 'GROCERY OUTLET #253', '253', '3644197', '6505614394'),
  ('Grocery Outlet', 'GROCERY OUTLET #294', '294', '3933023', '6503555100'),
  ('Grocery Outlet', 'GROCERY OUTLET #151', '151', '3330641', '4084405920'),
  ('Grocery Outlet', 'GROCERY OUTLET #184', '184', '3432369', '4088482700'),
  ('Grocery Outlet', 'GROCERY OUTLET #245', '245', '3621920', '4158765576'),
  ('Grocery Outlet', 'GROCERY OUTLET #297', '297', '3922580', '9255240004'),
  ('Grocery Outlet', 'GROCERY OUTLET #242', '242', '3568529', '5106192640'),
  ('Grocery Outlet', 'GROCERY OUTLET #269', '269', '3763883', '9256847439'),
  ('Grocery Outlet', 'GROCERY OUTLET #3', '3', '534799', '5104655649'),
  ('Grocery Outlet', 'GROCERY OUTLET #280', '280', '3948153', '5102394439'),
  ('Grocery Outlet', 'GROCERY OUTLET #11', '11', '2143387', '9256763660'),
  ('Grocery Outlet', 'GROCERY OUTLET #181', '181', '3235288', '9253633421'),
  ('Grocery Outlet', 'GROCERY OUTLET #35', '35', '2014628', '9259610019'),
  ('Grocery Outlet', 'GROCERY OUTLET #268', '268', '3931599', '9257765722'),
  ('Grocery Outlet', 'GROCERY OUTLET #382', '382', '4152717', '5104009524'),
  ('Grocery Outlet', 'GROCERY OUTLET #440', '440', '4464288', '9253903990'),
  ('Grocery Outlet', 'GROCERY OUTLET #439', '439', '4390083', '5103971734'),
  ('Grocery Outlet', 'GROCERY OUTLET #478', '478', '4410252', '9253988649'),
  ('Grocery Outlet', 'GROCERY OUTLET #31', '31', '3244544', '5102233404'),
  ('Grocery Outlet', 'GROCERY OUTLET #138', '138', '3103982', '5108953605'),
  ('Grocery Outlet', 'GROCERY OUTLET #133', '133', '2143386', '5107915124'),
  ('Grocery Outlet', 'GROCERY OUTLET #65', '65', '1343327', '5109651020'),
  ('Grocery Outlet', 'GROCERY OUTLET #52', '52', '2212308', '5107233336'),
  ('Grocery Outlet', 'GROCERY OUTLET #82', '82', '3035103', '5108818020'),
  ('Grocery Outlet', 'GROCERY OUTLET #33', '33', '3236989', '5106512005'),
  ('Grocery Outlet', 'GROCERY OUTLET #182', '182', '3231080', '9255571361'),
  ('Total Wine', 'TOTAL WINE & MORE #1106', '1106', '3250702', '3105421460'),
  ('Total Wine', 'TOTAL WINE & MORE #1147', '1147', '4804461', '9093284800'),
  ('Total Wine', 'TOTAL WINE & MORE #1132', '1132', '4532957', '9099621348'),
  ('Total Wine', 'TOTAL WINE & MORE #1105', '1105', '3209526', '7146720323'),
  ('Total Wine', 'TOTAL WINE & MORE #1121', '1121', '4052116', '9254630233'),
  ('Total Wine', 'TOTAL WINE & MORE #1124', '1124', '4047850', '9252759239'),
  ('Total Wine', 'TOTAL WINE & MORE #1118', '1118', '3998631', '9255880215'),
  ('Total Wine', 'TOTAL WINE & MORE #1146', '1146', '4815716', '5109894299'),
  ('Total Wine', 'TOTAL WINE & MORE #1115', '1115', '3947884', '5104030126');

-- Find each store's account: outlet id for Grocery Outlet / Total Wine, store number for BevMo
-- (only when exactly one BevMo account has that number).
drop table if exists pg_temp._ccs_match;
create temp table _ccs_match as
select s.chain, s.store, s.storeno, s.outlet,
  case when s.chain = 'BevMo' then
    (select min(a.outlet_id) from public.sales_accounts a
      where a.name ~* '^bev\s*mo' and substring(a.name from '#\s*0*([0-9]+)') = s.storeno
      having count(*) = 1)
  else
    (select a.outlet_id from public.sales_accounts a where a.outlet_id = s.outlet)
  end as oid
from (select distinct chain, store, storeno, outlet from _ccs_contacts
      union select distinct chain, store, storeno, outlet from _ccs_phones) s;

drop table if exists pg_temp._ccs_log;
create temp table _ccs_log (step text, n int);

-- 1) Same-name contact already on the account: fill its blanks only.
--    If that name is on file more than once (e.g. CRM Export + KARMA), only one is
--    filled: the CRM Export one first, else the oldest.
with src as (
  select m.oid, c.* from _ccs_contacts c
  join _ccs_match m on m.chain = c.chain and m.store = c.store
  where m.oid is not null
), target as (
  select distinct on (k.outlet_id, lower(btrim(k.name))) k.id, s.title, s.phone, s.email, s.notes
  from public.sales_account_contacts k
  join src s on k.outlet_id = s.oid and lower(btrim(k.name)) = lower(btrim(s.name))
  where coalesce(k.source, '') <> 'Chain Call Sheet'
  order by k.outlet_id, lower(btrim(k.name)), (k.source = 'CRM Export') desc, k.created_at, k.id
), upd as (
  update public.sales_account_contacts k set
    title = coalesce(nullif(k.title, ''), nullif(s.title, '')),
    phone = coalesce(nullif(k.phone, ''), nullif(s.phone, '')),
    email = coalesce(nullif(k.email, ''), nullif(s.email, '')),
    notes = coalesce(nullif(k.notes, ''), nullif(s.notes, ''))
  from target s
  where k.id = s.id
    and ( (coalesce(k.title, '') = '' and s.title <> '')
       or (coalesce(k.phone, '') = '' and s.phone <> '')
       or (coalesce(k.email, '') = '' and s.email <> '')
       or (coalesce(k.notes, '') = '' and s.notes <> '') )
  returning k.id
)
insert into _ccs_log select 'Existing contacts filled in', count(*) from upd;

-- 2) New contacts.
with ins as (
  insert into public.sales_account_contacts (outlet_id, name, title, phone, email, notes, source)
  select m.oid, c.name, nullif(c.title, ''), nullif(c.phone, ''), nullif(c.email, ''), nullif(c.notes, ''), 'Chain Call Sheet'
  from _ccs_contacts c
  join _ccs_match m on m.chain = c.chain and m.store = c.store
  where m.oid is not null
    and not exists (select 1 from public.sales_account_contacts k
                    where k.outlet_id = m.oid and lower(btrim(k.name)) = lower(btrim(c.name)))
  returning outlet_id
)
insert into _ccs_log select 'Contacts added', count(*) from ins;

-- 3) Store phone on the account, only where blank.
with upd as (
  update public.sales_accounts a set phone = p.phone, updated_at = now()
  from _ccs_phones p join _ccs_match m on m.chain = p.chain and m.store = p.store
  where a.outlet_id = m.oid and m.oid is not null
    and coalesce(a.phone, '') = '' and p.phone <> ''
  returning a.outlet_id
)
insert into _ccs_log select 'Store phones filled in (were blank)', count(*) from upd;

-- 4) Keep the account's contact count in step (the nightly refresh does the same).
update public.sales_accounts a set contact_count = c.n
from (select outlet_id, count(*)::int as n from public.sales_account_contacts
      where outlet_id in (select oid from _ccs_match where oid is not null)
      group by outlet_id) c
where a.outlet_id = c.outlet_id and a.contact_count is distinct from c.n;

-- Summary (stores whose phone on file differs from the sheet keep the phone on file;
-- the sheet's number is on the contact).
select step as "Result", n::text as "Count / detail" from _ccs_log
union all
select 'Not found in FCB-Data (skipped)', chain || ' ' || store || coalesce(' (outlet ' || nullif(outlet, '') || ')', '')
from _ccs_match where oid is null;
