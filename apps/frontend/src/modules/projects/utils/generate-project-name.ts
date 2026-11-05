import { generate } from 'random-words';

export const generateProjectName = (): string => {
  return (generate(2) as string[]).join('-');
};
