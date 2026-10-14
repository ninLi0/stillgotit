# Matrix multiplication — test fixture

This short source is for software tests. It is not an MIT course handout.

For A with m rows and n columns and B with n rows and p columns, AB has m rows and p columns.
The entry in row i and column j is the sum of A[i,k] times B[k,j] over k.
Each output entry combines one row of A with one column of B.

For the row [1, 2] and column [3, 4], the result is 1 × 3 + 2 × 4 = 11.
Changing the multiplication order changes the pairs of rows and columns. AB and BA need not be equal.
One order may be defined while the other is not.

Skills: compute a product, check dimensions, and explain why order matters.
