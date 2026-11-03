import {
  Prisma,
  type IngredientUnit,
  type PrismaClient,
  type Size,
} from '../src/generated/prisma/client.js';

// Explicit LOCAL/TEST assumptions, not production recipes or a physical count.
// Amounts use base units and decimal strings, never JS floating-point arithmetic.
const INGREDIENTS: Array<{
  code: string;
  name: string;
  unit: IngredientUnit;
  stock: string;
}> = [
  { code: 'COFFEE_BEANS', name: 'Cà phê hạt', unit: 'GRAM', stock: '2000' },
  { code: 'FRESH_MILK', name: 'Sữa tươi', unit: 'MILLILITRE', stock: '15000' },
  {
    code: 'CONDENSED_MILK',
    name: 'Sữa đặc',
    unit: 'MILLILITRE',
    stock: '6000',
  },
  { code: 'TEA_LEAVES', name: 'Lá trà', unit: 'GRAM', stock: '1000' },
  { code: 'MATCHA', name: 'Bột matcha', unit: 'GRAM', stock: '1000' },
  { code: 'SUGAR', name: 'Đường', unit: 'GRAM', stock: '5000' },
  { code: 'WATER', name: 'Nước pha chế', unit: 'MILLILITRE', stock: '50000' },
  { code: 'ICE', name: 'Đá', unit: 'GRAM', stock: '30000' },
  { code: 'PEACH_PIECE', name: 'Miếng đào', unit: 'PIECE', stock: '200' },
  {
    code: 'LYCHEE_PIECE',
    name: 'Quả vải đã sơ chế',
    unit: 'PIECE',
    stock: '400',
  },
  {
    code: 'COOKED_PEARLS',
    name: 'Trân châu đã nấu',
    unit: 'GRAM',
    stock: '4000',
  },
  { code: 'SALT', name: 'Muối', unit: 'GRAM', stock: '300' },
  {
    code: 'PREPARED_CHEESE',
    name: 'Kem cheese đã chuẩn bị',
    unit: 'GRAM',
    stock: '2000',
  },
  {
    code: 'PREPARED_JELLY',
    name: 'Thạch đã chuẩn bị',
    unit: 'GRAM',
    stock: '3000',
  },
];

// Finished toppings only: no manufacturing recipe or separate topping stock.
const TOPPING_SERVINGS = [
  { name: 'Trân châu', code: 'COOKED_PEARLS', quantity: '50' },
  { name: 'Kem cheese', code: 'PREPARED_CHEESE', quantity: '30' },
  { name: 'Thạch', code: 'PREPARED_JELLY', quantity: '40' },
];

// Each tuple explicitly specifies S / M / L. PIECE entries remain whole numbers.
type SizeAmounts = [string, string, string];
const PRODUCT_RECIPES: Record<string, Record<string, SizeAmounts>> = {
  'Cà phê sữa': {
    COFFEE_BEANS: ['16', '20', '24'],
    CONDENSED_MILK: ['20', '25', '30'],
    WATER: ['60', '80', '100'],
    ICE: ['100', '140', '180'],
  },
  Americano: {
    COFFEE_BEANS: ['14', '18', '22'],
    WATER: ['130', '180', '230'],
    ICE: ['100', '140', '180'],
  },
  Cappuccino: {
    COFFEE_BEANS: ['16', '20', '24'],
    FRESH_MILK: ['100', '130', '160'],
    WATER: ['30', '40', '50'],
  },
  Latte: {
    COFFEE_BEANS: ['16', '20', '24'],
    FRESH_MILK: ['140', '180', '220'],
    WATER: ['30', '40', '50'],
  },
  'Bạc xỉu': {
    COFFEE_BEANS: ['8', '10', '12'],
    FRESH_MILK: ['90', '120', '150'],
    CONDENSED_MILK: ['20', '25', '30'],
    WATER: ['20', '30', '40'],
    ICE: ['100', '140', '180'],
  },
  'Cà phê muối': {
    COFFEE_BEANS: ['16', '20', '24'],
    FRESH_MILK: ['60', '80', '100'],
    CONDENSED_MILK: ['20', '25', '30'],
    SALT: ['0.500', '0.750', '1'],
    WATER: ['50', '70', '90'],
    ICE: ['100', '140', '180'],
  },
  'Trà đào': {
    TEA_LEAVES: ['5', '7', '9'],
    WATER: ['140', '180', '220'],
    SUGAR: ['10', '15', '20'],
    PEACH_PIECE: ['1', '2', '3'],
    ICE: ['100', '140', '180'],
  },
  'Trà vải': {
    TEA_LEAVES: ['5', '7', '9'],
    WATER: ['140', '180', '220'],
    SUGAR: ['10', '15', '20'],
    LYCHEE_PIECE: ['2', '3', '4'],
    ICE: ['100', '140', '180'],
  },
  'Trà sữa trân châu': {
    TEA_LEAVES: ['5', '7', '9'],
    FRESH_MILK: ['80', '110', '140'],
    WATER: ['80', '100', '120'],
    SUGAR: ['10', '15', '20'],
    COOKED_PEARLS: ['20', '25', '30'],
    ICE: ['100', '140', '180'],
  },
  'Matcha đá xay': {
    MATCHA: ['4', '5', '6'],
    FRESH_MILK: ['120', '150', '180'],
    SUGAR: ['12', '15', '18'],
    ICE: ['160', '200', '240'],
  },
};

export async function seedDemoInventory(prisma: PrismaClient) {
  return prisma.$transaction(
    async (tx) => {
      // Serialize concurrent demo-seed runs, without locking unrelated app writes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('brewlite:demo-inventory:v1'))`;
      const ingredients = new Map<
        string,
        { id: number; unit: IngredientUnit }
      >();
      for (const entry of INGREDIENTS) {
        let ingredient = await tx.ingredient.findUnique({
          where: { code: entry.code },
        });
        if (!ingredient) {
          ingredient = await tx.ingredient.create({
            data: {
              code: entry.code,
              name: entry.name,
              unit: entry.unit,
              stockQuantity: new Prisma.Decimal(entry.stock),
              reservedQuantity: 0,
            },
          });
          await tx.inventoryMovement.create({
            data: {
              eventKey: `seed:ingredient-opening:v1:${entry.code}`,
              kind: 'RECEIPT',
              ingredientId: ingredient.id,
              unit: ingredient.unit,
              stockDelta: ingredient.stockQuantity,
              reservedDelta: 0,
              reason: 'Tồn đầu mẫu local/test, không suy từ Product.stock',
            },
          });
        }
        if (ingredient.unit !== entry.unit)
          throw new Error(
            `Demo ingredient ${entry.code}: unit differs from the demo configuration; no conversion or overwrite performed`,
          );
        ingredients.set(entry.code, ingredient);
      }

      for (const entry of TOPPING_SERVINGS) {
        // Fill only unconfigured demo toppings. Never replace a manager's mapping
        // or serving quantity, and never write stock when linking a topping.
        await tx.topping.updateMany({
          where: {
            name: entry.name,
            ingredientId: null,
            quantityPerServing: null,
          },
          data: {
            ingredientId: ingredients.get(entry.code)!.id,
            quantityPerServing: new Prisma.Decimal(entry.quantity),
          },
        });
      }

      const sizes: Size[] = ['S', 'M', 'L'];
      for (const [name, formula] of Object.entries(PRODUCT_RECIPES)) {
        const product = await tx.product.findUnique({
          where: { name },
          select: { id: true },
        });
        if (!product)
          throw new Error(
            `Missing demo product: ${name}. Seed the catalog first.`,
          );
        for (const [index, size] of sizes.entries()) {
          await tx.productRecipe.upsert({
            where: { productId_size: { productId: product.id, size } },
            update: {},
            create: {
              productId: product.id,
              size,
              isActive: true,
              ingredients: {
                create: Object.entries(formula).map(([code, amounts]) => ({
                  ingredientId: ingredients.get(code)!.id,
                  unit: ingredients.get(code)!.unit,
                  quantity: new Prisma.Decimal(amounts[index]),
                })),
              },
            },
          });
        }
      }
    },
    { timeout: 15000 },
  );
}
