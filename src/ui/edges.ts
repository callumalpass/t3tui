/**
 * Border characters for opencode's signature edge: a heavy left bar and
 * nothing else. Use with `border={["left"]}` and a background colour, so the
 * block's shade, not a box outline, is what separates it.
 */
export const BAR = {
  topLeft: "",
  bottomLeft: "",
  vertical: "┃",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};

/** No visible border at all; the space keeps a border's width where one is needed for layout. */
export const NO_BORDER = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};
