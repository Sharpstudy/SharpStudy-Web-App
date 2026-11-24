# Trainer portraits: generation prompts and how to add them

**Status: the ten portraits have NOT been generated.** No image-generation tool was available when this section was built, and no stock or lookalike photograph was substituted. The About page currently shows neutral silhouette placeholders and says so. Everything else (layout, data file, responsive grid, reveal animation, disclosure notice, tests) is in place.

These are portraits of **fictional** people. They must not be presented as real SharpStudy staff. The page's notice ("AI-generated illustrations of fictional people, not photographs of SharpStudy staff") appears automatically once the portraits are switched on.

## Generate ten SEPARATE images

Generate each portrait in its own request (never a collage). Use the same model, the same settings and the shared block below for every one, so that they look like one photo session.

**Output:** 4:5 portrait, at least 1600 x 2000 px (the site uses 800 x 1000).

### Shared style block (paste into every prompt)

> Photorealistic professional corporate headshot of ONE adult Indian education professional, head-and-shoulders (chest up), facing the camera at a slight angle, warm approachable expression, natural skin texture with visible pores and fine detail (no airbrushing or plastic smoothing), realistic eyes, natural hair and proportionate facial features, anatomically correct, soft natural window light from the front-left with gentle fill, shot on an 85mm lens at f/2.8, shallow depth of field, clean softly blurred neutral studio background in light warm grey with a very subtle cool-blue tint, natural colour grading, vertical 4:5 composition with a little space above the head, magazine-quality documentary corporate photography.
> Negative: no text, no logos, no watermark, no company branding, no hands in frame, no cartoon or illustration look, no glamour or fashion-editorial styling, no heavy makeup, no identical or generic "AI face", no distorted features, no extra people.

### The ten individuals (append one to the shared block)

1. **Senior male education mentor**, about 40-45, warm and experienced expression, navy-blue blazer over a light shirt, short dark hair with a little grey at the temples, light stubble.
2. **Female communication trainer**, about 30-38, confident and approachable, pastel (soft lilac or sage) formal blouse with a light blazer, shoulder-length dark hair worn loose.
3. **Male mathematics educator**, about 28-35, friendly and intelligent, smart-casual collared shirt with sleeves neatly rolled or a light cardigan, thin-framed glasses, short neat hair.
4. **Female personality development coach**, about 30-40, confident, elegant professional outfit (a dark teal or maroon structured top), hair in a neat low bun, small stud earrings.
5. **Male leadership trainer**, about 35-42, experienced mentor look, charcoal or black formal blazer with a crisp shirt, short hair, trimmed beard.
6. **Female public speaking coach**, about 28-35, expressive and confident with a slight natural smile, professional formal outfit in a bold colour such as deep blue, medium-length wavy hair.
7. **Male learning and technology mentor**, about 27-34, friendly, modern smart-casual (fine-knit sweater or open-collar shirt under an unstructured jacket), short textured hair, clean-shaven.
8. **Female creative learning educator**, about 28-36, warm and creative, pastel professional outfit (soft peach or sky blue), hair in a side braid or loose curls, a light scarf optional.
9. **Male student development mentor**, about 32-40, approachable, professional shirt and blazer in a mid-brown or olive tone, short hair, light stubble.
10. **Female senior education mentor**, about 38-45, experienced and trustworthy, professional formal attire (a dark saree-style drape or a tailored dark jacket), hair pulled back neatly with a hint of silver, thin glasses optional.

Check the ten results against each other: ten clearly different faces (no repeated facial structure), five men and five women, similar lighting and framing, no extra fingers or hands visible, no text or logos, no watermark. Regenerate any that fail.

## Add them to the site

1. Save as `public/images/team/trainers/trainer-01.webp` ... `trainer-10.webp` (numbers follow the list above). Do not overwrite anything else in `public/images/team/`.
2. Resize and compress, for example with ffmpeg:
   `ffmpeg -i source-01.png -vf "scale=800:1000:force_original_aspect_ratio=increase,crop=800:1000" -c:v libwebp -quality 82 public/images/team/trainers/trainer-01.webp`
   Aim for about 40-90 KB each.
3. In `lib/trainers/data.js` set `PORTRAITS_AVAILABLE = true`. The unit test then verifies that all ten files exist, have the stated size and differ from each other.
4. Do not add names, qualifications, certifications or years of experience for these fictional people. If real trainers are announced, replace the label and text in `lib/trainers/data.js` for them and set `fictional: false`.
