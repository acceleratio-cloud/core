import math
def oklch_to_srgb(L,C,h):
    a=C*math.cos(math.radians(h)); b=C*math.sin(math.radians(h))
    l_=L+0.3963377774*a+0.2158037573*b
    m_=L-0.1055613458*a-0.0638541728*b
    s_=L-0.0894841775*a-1.2914855480*b
    l,m,s=l_**3,m_**3,s_**3
    r=4.0767416621*l-3.3077115913*m+0.2309699292*s
    g=-1.2684380046*l+2.6097574011*m-0.3413193965*s
    bl=-0.0041960863*l-0.7034186147*m+1.7076147010*s
    return [max(0,min(1,x)) for x in (r,g,bl)]  # linear
def lum(c): return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def ratio(a,b):
    la,lb=lum(a),lum(b)
    if la<lb: la,lb=lb,la
    return (la+0.05)/(lb+0.05)
def g(L): return oklch_to_srgb(L,0,0)
panel=g(1); board=g(0.945); canvas=g(0.97); sunken=g(0.975)
print("TEXT (on panel / board)")
for n,L in [("primary .145",.145),("secondary .44",.44),("tertiary .52",.52),("old slate .556",.556),("old slate on enamel .985",None)]:
    if L is None: print(n, round(ratio(g(.556),g(.985)),2)); continue
    print(n, round(ratio(g(L),panel),2), round(ratio(g(L),board),2))
print("BORDERS vs panel / board")
for n,L in [("subtle .93",.93),("default .87",.87),("control .66",.66),("control .62",.62),("control .60",.60),("old input .822",.822),("old border .915",.915)]:
    print(n, round(ratio(g(L),panel),2), round(ratio(g(L),board),2))
print("SURFACE steps vs neighbor")
print("panel/board", round(ratio(panel,board),3), "panel/canvas", round(ratio(panel,canvas),3), "board/canvas", round(ratio(board,canvas),3))
print("STATUS fg on panel")
for n,c in [("green .52 .14 150",(.52,.14,150)),("amber .55 .13 75",(.55,.13,75)),("red .54 .22 27",(.54,.22,27))]:
    print(n, round(ratio(oklch_to_srgb(*c),panel),2))
print("ACCENT-600 vs white (white text on accent)")
for n,c in [("indigo .50 .19 268",(.50,.19,268)),("teal .52 .10 195",(.52,.10,195)),("blue .52 .19 252",(.52,.19,252))]:
    print(n, round(ratio(oklch_to_srgb(*c),panel),2))
