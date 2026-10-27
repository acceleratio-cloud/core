# Centered datacenter interior

Edited with the built-in ImageGen tool for the full-screen authentication layout.

Asset: `apps/frontend/public/auth/datacenter-centered.png`

Reference image: `apps/frontend/public/auth/datacenter-interior.png`

The aisle, rear doorway and floor centerline share the image's horizontal center.
The layout uses centered cover cropping and a separate CSS dimming layer.

## Prompt

```text
Use case: precise-object-edit
Asset type: full-screen datacenter background behind a centered login card.
Input image: edit target; preserve the realistic datacenter interior, materials and lighting.
Primary request: correct the camera position and perspective so the ENTIRE ARCHITECTURAL AXIS IS EXACTLY AT THE HORIZONTAL CENTER OF THE IMAGE. Recompose the image into a wide LANDSCAPE 16:9 frame, ideally 1920 x 1080. This is a geometry and framing correction, not a new visual style.
Critical geometry:
- Place the camera directly on the centerline of the server aisle, looking straight ahead with no sideways angle, yaw, roll or tilt.
- The single vanishing point must be at EXACTLY x = 50% of the image width, approximately y = 46% of the height.
- The aisle centerline, midpoint of the rear glass doorway, ceiling centerline, and the central raised-floor seam all share the SAME straight vertical axis at x = 50%.
- The central floor joint must run vertically upward from the exact bottom-center toward that centered vanishing point. It must not drift to the left or right in the foreground.
- Server rows flank the aisle with equal apparent widths and balanced perspective on both sides. Near cabinet edges and floor boundaries converge equally toward the central vanishing point.
- Two slim neutral-white ceiling lights flank the centerline at equal distances. No single offset ceiling light, offset floor seam or door mullion should create a competing central axis.
Architecture: believable full-height graphite perforated-metal server cabinets on both sides, clean matte gray raised floor, real dark ceiling with neat cable trays, dark rear glass double door centered in the aisle. Keep natural equipment detail and subtle blue status indicators. Use distinct natural details on the two sides rather than copying and mirroring identical pixels.
Style: high-end authentic architectural photography of a real datacenter, physically plausible materials, straight verticals, a tilt-corrected 28–35mm lens, realistic proportions. Retain the tactile dark metal, restrained smoked glass, neutral floor and installed neutral-white lighting of the input. Dark but readable exposure.
Composition: fully centered one-point architectural perspective; the image center is the center of the aisle at every depth. The central alignment must remain convincing when cropped symmetrically into portrait, square, or ultrawide containers. Fill the frame edge to edge; no borders or blank gutters.
Constraints: do not add a login form or UI. No people, text, labels, readable numbers, logos, watermark, stars, clouds, fog, fantasy elements, colorful lighting, excessive blue glow or exaggerated lens distortion. Keep the same room aesthetic; correct its off-center perspective.
```
