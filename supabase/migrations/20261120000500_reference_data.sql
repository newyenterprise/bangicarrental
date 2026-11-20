-- Bangi Car Rental: starting reference data (safe for production).
-- No customers, bookings, payments or admin accounts are created here.
-- Values marked as unconfirmed must be reviewed in Admin > Settings before launch.

insert into public.app_settings (id, display_name, pickup_area, email_from, email_reply_to)
values (1, 'Bangi Car Rental', 'Bangi', '', '')
on conflict (id) do nothing;

insert into public.vehicle_models
  (slug, name, seats, transmission, tagline_ms, tagline_en, image_url, daily_rate_sen, deposit_sen, prep_buffer_minutes, status, sort_order)
values
  ('nissan-serena', 'Nissan Serena', 7, 'automatic', 'MPV keluarga hibrid', 'Hybrid family MPV',
   '/vehicles/nissan-serena.webp', 35000, 50000, 120, 'bookable', 1),
  ('toyota-vellfire', 'Toyota Vellfire', 7, 'automatic', 'MPV premium', 'Premium MPV',
   '/vehicles/toyota-vellfire.webp', 0, 0, 120, 'preview', 2),
  ('toyota-alphard', 'Toyota Alphard', 7, 'automatic', 'MPV premium', 'Premium MPV',
   '/vehicles/toyota-alphard.webp', 0, 0, 120, 'preview', 3)
on conflict (slug) do nothing;

-- One physical Serena. Registration number and year are entered by the operator in Admin > Fleet.
insert into public.vehicles (model_id, label, registration_no, notes)
select m.id, 'Serena 1', '', 'Nissan Serena Highway Star Hybrid'
from public.vehicle_models m
where m.slug = 'nissan-serena'
  and not exists (select 1 from public.vehicles v where v.model_id = m.id);

-- Starter agreement templates, saved as DRAFTS. Renters cannot sign until the
-- operator reviews and publishes a version in Admin > Agreement.
insert into public.agreement_templates (locale, version, title, body, status)
values
('ms', 1, 'Perjanjian Sewa Kenderaan', $ms$
## 1. Pihak-pihak
Perjanjian ini dibuat antara {{company_name}} ("Pemilik") dan {{renter_name}}, No. Pengenalan {{renter_id_number}} ("Penyewa"), bagi tempahan {{booking_reference}}.

## 2. Kenderaan
Pemilik menyewakan kenderaan berikut kepada Penyewa: {{vehicle_name}}, No. Pendaftaran {{registration_no}}.

## 3. Tempoh sewa
Ambil: {{pickup_at}}
Pulang: {{return_at}}
Tempoh: {{days}} hari. Setiap tempoh 24 jam atau sebahagian daripadanya dikira sebagai satu hari.

## 4. Caj sewa
Kadar harian: {{daily_rate}}
Jumlah sewa: {{rental_total}}
Caj sewa telah dibayar secara dalam talian semasa tempahan.

## 5. Deposit keselamatan
Deposit keselamatan boleh dipulangkan sebanyak {{deposit}} dibayar semasa mengambil kenderaan. Deposit dipulangkan selepas kenderaan dipulangkan dan diperiksa, tertakluk kepada potongan bagi kerosakan, kekurangan bahan api, kelewatan, saman atau caj lain yang timbul sepanjang tempoh sewa. Setiap potongan akan dinyatakan sebabnya kepada Penyewa.

## 6. Pemandu yang dibenarkan
Hanya pemandu berikut dibenarkan memandu kenderaan: {{drivers}}.
Setiap pemandu mesti memiliki lesen memandu yang sah sepanjang tempoh sewa.

## 7. Penggunaan kenderaan
Penyewa bersetuju untuk:
- menggunakan kenderaan secara berhemah dan mematuhi semua undang-undang jalan raya;
- tidak menggunakan kenderaan untuk tujuan yang menyalahi undang-undang, perlumbaan, menunda, atau membawa penumpang berbayar;
- tidak membawa kenderaan keluar dari Malaysia tanpa kebenaran bertulis Pemilik;
- tidak merokok di dalam kenderaan;
- tidak menyewakan semula atau meminjamkan kenderaan kepada pihak lain.

## 8. Bahan api dan keadaan kenderaan
Kenderaan hendaklah dipulangkan dengan paras bahan api yang sama seperti semasa diambil dan dalam keadaan bersih yang munasabah. Bacaan odometer, paras bahan api dan keadaan kenderaan direkodkan semasa ambil dan pulang.

## 9. Saman dan kesalahan trafik
Penyewa bertanggungjawab ke atas semua saman, kompaun, tol dan caj tempat letak kereta yang timbul sepanjang tempoh sewa.

## 10. Kemalangan, kerosakan dan kehilangan
Penyewa mesti memaklumkan Pemilik dengan segera jika berlaku kemalangan, kerosakan, kecurian atau kehilangan, dan membuat laporan polis dalam tempoh 24 jam. Penyewa bertanggungjawab ke atas kerosakan atau kehilangan yang berpunca daripada kecuaian atau pelanggaran perjanjian ini, setakat yang dibenarkan oleh undang-undang.

## 11. Pemulangan lewat
Pemulangan lewat tanpa persetujuan Pemilik boleh dikenakan caj tambahan berdasarkan kadar harian.

## 12. Pembatalan dan bayaran balik
{{cancellation_terms}}

## 13. Data peribadi
Maklumat dan dokumen Penyewa digunakan untuk mengurus sewaan ini sahaja dan disimpan secara sulit selaras dengan Akta Perlindungan Data Peribadi 2010.

## 14. Undang-undang
Perjanjian ini ditadbir oleh undang-undang Malaysia.

## 15. Pengakuan
Dengan menandatangani perjanjian ini, Penyewa mengesahkan bahawa semua maklumat yang diberikan adalah benar dan Penyewa telah membaca, memahami dan bersetuju dengan terma di atas.
$ms$, 'draft'),
('en', 1, 'Vehicle Rental Agreement', $en$
## 1. Parties
This agreement is made between {{company_name}} (the "Owner") and {{renter_name}}, ID No. {{renter_id_number}} (the "Renter"), for booking {{booking_reference}}.

## 2. Vehicle
The Owner rents the following vehicle to the Renter: {{vehicle_name}}, Registration No. {{registration_no}}.

## 3. Rental period
Pickup: {{pickup_at}}
Return: {{return_at}}
Duration: {{days}} day(s). Each 24-hour period, or any part of one, counts as one day.

## 4. Rental charges
Daily rate: {{daily_rate}}
Rental total: {{rental_total}}
The rental charge was paid online at the time of booking.

## 5. Security deposit
A refundable security deposit of {{deposit}} is payable when the vehicle is collected. The deposit is returned after the vehicle has been returned and inspected, less any deductions for damage, missing fuel, late return, fines or other charges arising during the rental period. The reason for each deduction will be given to the Renter.

## 6. Authorised drivers
Only the following drivers may drive the vehicle: {{drivers}}.
Each driver must hold a valid driving licence for the whole rental period.

## 7. Use of the vehicle
The Renter agrees to:
- drive with care and obey all road traffic laws;
- not use the vehicle for any unlawful purpose, racing, towing or carrying paying passengers;
- not take the vehicle out of Malaysia without the Owner's written consent;
- not smoke in the vehicle;
- not sub-rent or lend the vehicle to anyone else.

## 8. Fuel and condition
The vehicle must be returned with the same fuel level as at pickup and in a reasonably clean condition. The odometer reading, fuel level and vehicle condition are recorded at pickup and return.

## 9. Fines and traffic offences
The Renter is responsible for all summonses, compounds, tolls and parking charges incurred during the rental period.

## 10. Accidents, damage and loss
The Renter must tell the Owner immediately of any accident, damage, theft or loss, and make a police report within 24 hours. The Renter is responsible for damage or loss caused by negligence or by a breach of this agreement, to the extent permitted by law.

## 11. Late return
Returning the vehicle late without the Owner's agreement may incur additional charges based on the daily rate.

## 12. Cancellation and refunds
{{cancellation_terms}}

## 13. Personal data
The Renter's information and documents are used only to manage this rental and are kept confidential in line with the Personal Data Protection Act 2010.

## 14. Governing law
This agreement is governed by the laws of Malaysia.

## 15. Acknowledgement
By signing this agreement, the Renter confirms that all information provided is true and that the Renter has read, understood and agrees to the terms above.
$en$, 'draft')
on conflict (locale, version) do nothing;
