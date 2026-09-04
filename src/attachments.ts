import { reactive } from "vue";

export interface CardAttachment {
  id: number;
  title: string;
  content: string;
}

export interface FileAttachment {
  id: number;
  name: string;
  content: string;
  size: number;
}

export const cardAttachments = reactive({
  items: [] as CardAttachment[],
});

export const fileAttachments = reactive({
  items: [] as FileAttachment[],
});

export function addCardAttachment(title: string, content: string) {
  cardAttachments.items.push({
    id: Date.now(),
    title,
    content,
  });
}

export function removeCardAttachment(id: number) {
  cardAttachments.items = cardAttachments.items.filter((item) => item.id !== id);
}

export function addFileAttachment(name: string, content: string, size: number) {
  fileAttachments.items.push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    name,
    content,
    size,
  });
}

export function removeFileAttachment(id: number) {
  fileAttachments.items = fileAttachments.items.filter((item) => item.id !== id);
}