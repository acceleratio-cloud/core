# Infinite datacenter rows

Generated with the built-in ImageGen tool for the authentication layout.

Previous variant: `apps/frontend/public/auth/datacenter-infinite-rows.png`

Base image: `apps/frontend/public/auth/datacenter-server-rows.png`

## Base prompt

```text
Use case: stylized-concept
Asset type: full-bleed datacenter illustration for a cloud provider login page, filling a large landscape right-side panel.
Primary request: create a cinematic, premium architectural 3D illustration of a vast datacenter, with MANY full-height server racks arranged in long parallel rows receding far into the distance. This is an expansive environment, not an isolated sculpture.
Scene/backdrop: a deep charcoal-black architectural space with a large calm, empty upper area. The TOP THIRD of the image is clean dark negative space, free of server racks, ceiling clutter or lights, for future white copy. Rows of servers occupy the LOWER TWO THIRDS and extend all the way to both side edges and the bottom edge.
Subject: dozens of physically plausible graphite server cabinets, repeated bays and horizontal compute/storage drawers behind fine perforated metal and subtly smoky-glass doors. Long orderly service aisles and rack rows converge toward a distant vanishing point slightly right of center, creating a strong sense of scale and depth. Foreground cabinets are large, detailed and intentionally cropped by the bottom and side edges; increasingly smaller racks stretch into darkness in the middle distance. All racks rest on a restrained dark architectural base, no floating objects.
Composition/framing: LANDSCAPE 4:3 image, ideally 1536 x 1152. A slightly elevated three-quarter camera looks diagonally along the server rows. Strong perspective and repeating architectural rhythm, asymmetric rather than a mirrored tunnel. Compose the entire image as one continuous full-bleed environment, no blank side gutters, no border, no inset picture, no pedestal object. Top 30-35 percent stays quiet and almost black. Essential datacenter depth and multiple server rows remain legible with modest cropping at either side.
Style/medium: tactile high-end 3D editorial architectural visualization, refined restrained realism, crisp geometric silhouette, coherent engineered construction, excellent physical material detail.
Materials/textures: matte black anodized aluminum, brushed graphite cabinet edges, perforated metal, occasional smoky glass, physically believable panel thickness and connections. Avoid shiny toy plastic.
Lighting/mood: directional neutral studio-like architectural light grazing the rack edges, deep controlled shadows with readable front panels, subtle atmospheric depth only in the far distance. A few tiny cool electric-blue status strips and recessed signal lights punctuate the rack rows; no neon wash.
Color palette: almost-black charcoal, graphite, muted silver highlights, one restrained cold electric-blue accent.
Text: none.
Constraints: no text, labels, letters, numbers, logos, branding, watermark, people, faces, hands, UI, charts, glowing orbs, bokeh, purple, rainbow colors, decorative particles, gradient background graphics, fantasy city, outer space, floating sculpture or foreground hero block. Keep the clean empty space at the top and the long server rows receding into the distance.
```

## Sky edit prompt

The requested stars and nebula clouds replace the original empty sky. The edit
uses the base image above as its reference and preserves the datacenter framing.

```text
Use case: precise-object-edit
Asset type: full-bleed cloud provider login illustration.
Input image: edit target; the existing datacenter scene.
Primary request: replace the empty dark sky in the TOP THIRD with an awe-inspiring, realistic deep-space sky: fine distant stars and beautifully illuminated, soft volumetric interstellar clouds. Make the sky visibly rich and cinematic, with natural cloud-like forms and depth, like a restrained astrophotograph of a cool blue nebula, not a flat texture.
Edit region: only the upper dark sky above the server-rack horizon, with a subtle seamless transition at the horizon.
Sky details: a fine natural star field of mostly tiny pinpoints with a few slightly brighter stars; a graceful irregular bank of realistic silver-blue and charcoal nebular clouds, luminous along selected wispy edges and softly shadowed within. Let darker voids remain between cloud formations. The clouds should have convincing atmospheric volume, delicate detail, and natural softness. Create grandeur and a sense of endless space, while keeping the sky dark enough for optional white copy.
Composition/framing: preserve the existing LANDSCAPE 4:3 canvas, the exact framing and perspective, the horizon position, the large foreground racks, all repeated server rows heading into the distance, and the aisle with its vanishing point slightly right of center. Keep the environment full-bleed with no side gutters or frame. The new sky must be noticeable in the upper third.
Preserve: all lower two-thirds datacenter geometry, cabinet materials, server details, subtle electric-blue indicators, rack arrangement, flooring, camera angle, image scale and lighting. Do not crop, enlarge, rearrange or replace the datacenter.
Color palette: graphite-black, charcoal, smoky silver, cool blue-gray nebula clouds, restrained cold-blue highlights, white stars. No purple, magenta, rainbow colors or oversaturated neon.
Style/medium: cinematic photoreal atmospheric space above a refined architectural 3D datacenter illustration; plausible natural cloud texture and accurate-looking tiny stars.
Text: none.
Constraints: no planets, moons, glowing orbs, giant starbursts, bokeh, lens flares, spacecraft, text, logos, numbers, watermarks, people, UI or charts. Do not put clouds over the server racks. Change only the upper sky, keeping the datacenter intact.
```

## Abstract atmosphere edit

Reference image: `apps/frontend/public/auth/datacenter-nebula.png`.

```text
Use case: precise-object-edit
Asset type: premium full-bleed cloud platform login illustration.
Input image: edit target; preserve its datacenter exactly and redesign only the upper sky.
Primary request: make the space above the server rows much more ABSTRACT, understated and sophisticated. Replace the current vivid, sharply sculpted blue nebula with broad soft translucent atmospheric veils: subtle smoky charcoal and desaturated slate-blue clouds dissolving into deep black, a quiet suggestion of immense space. The result must feel like a photographed optical atmosphere in an architectural editorial image, with beautiful soft material depth.
Edit region: only the top 37 percent above the server-rack horizon. Remove the current bright blue cloud ridges, intricate storm-cloud shapes, dramatic glowing edges and dense sparkling star field.
New sky: two or three very broad, diffuse overlapping smoky layers, asymmetrically sweeping across the upper area, soft low-frequency texture, gently varying translucency, a muted blue-gray light diffused INSIDE the haze rather than outlining it. Dark open areas remain between the layers. A sparse scattering of perhaps 20 to 30 very small, faint, irregular white star points suggests distance; no large or spiked stars. Sky luminosity should be restrained, with its brightest parts no brighter than the silver highlights on the rack tops. Keep the abstract smoky forms clearly visible but low contrast.
Visual character: calm, atmospheric, minimal, photographic softness, subtle tonal depth, refined and neutral. No recognizable giant cloud mountains, no storm, no fantasy nebula illustration, no colorful cosmic poster. Avoid sharply outlined shapes and decorative ribbon forms. No smooth artificial gradient graphic; use softly textured atmospheric volumes.
Preserve exactly: the lower datacenter, every server row, the aisle and vanishing point, blue status lights, foreground rack crop, metal textures, floor, perspective, lighting, horizon height and all structural details.
Composition: keep the original landscape 4:3 aspect ratio and edge-to-edge framing, no borders or side gutters. Keep clean negative space in the upper area for future white copy.
Palette: near-black graphite, smoky charcoal, desaturated blue-gray, silver-gray highlights; blue is only a subtle undertone.
Constraints: no cyan neon, purple, magenta, saturated colors, lightning, bright cloud outlines, crystalline or fractal edges, hard starbursts, lens flares, dense glitter, planets, moons, orbs, bokeh, text, logos, watermarks, people or UI. Do not add fog in front of the racks. Modify only the upper sky.
```

## Final infinite datacenter edit

Reference image: `apps/frontend/public/auth/datacenter-atmosphere.png`.

```text
Use case: precise-object-edit
Asset type: premium full-bleed datacenter image for a cloud provider login panel.
Input image: edit target. Retain its architectural materials and large foreground server racks, but redesign the upper half into an apparently endless continuation of the datacenter itself.
Primary request: remove the entire space sky, all stars and every cloud. Fill that area with many additional distant rows of server racks. The result should be a vast continuous field of infrastructure receding toward the top of the frame, with no sky and no visible end.
Composition: landscape 4:3. Use a slightly higher, downward-looking three-quarter architectural viewpoint so the scene contains only server rows and service aisles from the bottom edge to the top edge. The implied horizon and vanishing point are at or just beyond the upper-right edge, not at the old horizon line. Reproject the upper/middle distance as needed to make the perspective physically coherent. Do not simply place racks above an unchanged horizon. Keep the large closely viewed foreground cabinets at the lower left and right, their familiar framing and the strong diagonal service aisle.
Depth: foreground racks are large, tactile and readable. The same connected parallel rows continue smoothly through the middle ground into many progressively smaller racks in the upper half. At the very top the distant cabinet edges become delicate, darker and softly merge into subtle charcoal atmospheric depth. They must still read as server rows, not an empty band or cloud sky. Natural perspective rhythm; no abrupt transition, wall, dividing horizon, stacked floors or impossible vertical layers.
Style/medium: refined realistic architectural 3D editorial illustration. Monumental, quiet and precise. A coherent engineered environment rather than science-fiction spectacle. Repetition and material depth convey infinite scale.
Materials: preserve the reference's matte graphite metal, perforated cabinet doors, restrained smoked glass, silver-gray edge reflections, dark service aisles and a few subtle blue status indicators. Plausible panel joins and structural detail.
Lighting: soft directional neutral architectural illumination, controlled highlights on the rack tops, dark readable fronts. Reduce contrast naturally with distance. No broad blue glow.
Palette: near-black, charcoal, graphite, muted silver; restrained electric-blue indicator points only.
Preserve: the visual identity and realism of the reference datacenter, large foreground cabinets, continuous aisles, restrained lighting, full-bleed fit, landscape aspect ratio. Allow the upper and middle perspective to change so the extended rack rows fit naturally.
Text: none.
Constraints: absolutely NO sky, stars, space, nebula, clouds, mountains, landscape, celestial objects, bright light at the vanishing point, glowing portal, roof or ceiling features, sci-fi city, decorative fog banks, neon grids, bokeh, lens flare, oversaturated colors, text, labels, numbers, logos, people, UI, watermark, borders or blank side gutters. The upper area is distant server infrastructure, not a separate backdrop.
```
