/**
 * Instance names are `<service>-<template hash>-<id>`; only the last part
 * tells instances apart, so it is the label and the full name stays on hover
 * and copy.
 */
export const shortInstanceName = (name: string) => {
  const cut = name.lastIndexOf('-');

  return cut > 0 && cut < name.length - 1 ? name.slice(cut + 1) : name;
};
